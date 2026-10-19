import Papa from "papaparse";
import { parseDateFlexible } from "./dates";
import { parseAmount, roundQty, toPaise } from "./money";
import type { InstrumentKind, ISODate, Paise, TxnType } from "./types";

export type CsvField = "date" | "name" | "symbol" | "kind" | "type" | "qty" | "price" | "amount" | "charges" | "amfiCode";

export const CSV_FIELDS: { field: CsvField; label: string; hint: string }[] = [
  { field: "date", label: "Date", hint: "Trade / transaction date" },
  { field: "name", label: "Name", hint: "Stock, fund or deposit name" },
  { field: "symbol", label: "Symbol", hint: "NSE/BSE symbol (optional)" },
  { field: "amfiCode", label: "AMFI code", hint: "Mutual fund scheme code (optional)" },
  { field: "kind", label: "Instrument type", hint: "stock / etf / mf / gold … (optional)" },
  { field: "type", label: "Transaction type", hint: "buy / sell / sip … (default buy)" },
  { field: "qty", label: "Quantity / units", hint: "" },
  { field: "price", label: "Price per unit", hint: "Buy or average price" },
  { field: "amount", label: "Amount", hint: "Total paid/received (optional if qty × price)" },
  { field: "charges", label: "Charges", hint: "Brokerage, taxes (optional)" },
];

export type ColumnMap = Partial<Record<CsvField, number>>;

export interface CsvMapping {
  headerRow: number;
  columns: ColumnMap;
  dateOrder: "dmy" | "mdy" | "ymd";
  defaultKind: InstrumentKind;
  defaultType: TxnType;
}

export function parseCsvText(text: string): string[][] {
  const r = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  return r.data.map((row) => row.map((c) => (c ?? "").toString()));
}

const GUESS: [CsvField, RegExp][] = [
  ["date", /^(trade\s*)?date|^txn date|^transaction date|^dt$/i],
  ["amfiCode", /amfi|scheme\s*code/i],
  ["symbol", /^symbol|ticker|scrip|^nse|^code$/i],
  ["name", /stock\s*name|scheme\s*name|^name|instrument|security|^stock$|^fund$|company/i],
  ["kind", /^(asset|instrument)\s*type|^category$|^kind$/i],
  ["type", /^(txn\s*|transaction\s*)?type$|^action$|^side$|buy\s*\/\s*sell/i],
  ["qty", /^qty|quantity|^units|^shares/i],
  ["price", /avg\.?\s*price|average\s*price|buy\s*price|^price|^nav$|^rate$/i],
  ["amount", /^amount|^invested|net+\s*price|net\s*amount|total\s*cost|buy\s*value|^cost$/i],
  ["charges", /charge|brokerage|fees?$/i],
];

/** Guess which row is the header and which column holds which field. */
export function guessMapping(rows: string[][]): CsvMapping {
  let best = { row: 0, score: -1, columns: {} as ColumnMap };
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cols: ColumnMap = {};
    let score = 0;
    const row = rows[r] ?? [];
    for (const [field, re] of GUESS) {
      const idx = row.findIndex((h, i) => re.test(h.trim()) && !Object.values(cols).includes(i) && !/current|ltp|market|p\/?l/i.test(h));
      if (idx >= 0) {
        cols[field] = idx;
        score++;
      }
    }
    if (score > best.score) best = { row: r, score, columns: cols };
  }
  return { headerRow: best.row, columns: best.columns, dateOrder: "dmy", defaultKind: "stock", defaultType: "buy" };
}

export interface ParsedRow {
  line: number; // 1-based line in the file
  date: ISODate;
  name: string;
  symbol?: string;
  amfiCode?: string;
  kind: InstrumentKind;
  type: TxnType;
  qty?: number;
  price?: number;
  amount: Paise;
  charges?: Paise;
}

export interface RowError {
  line: number;
  reason: string;
  raw: string[];
}

const TYPE_WORDS: [RegExp, TxnType][] = [
  [/^(b|buy|bought|purchase|p)$/i, "buy"],
  [/^(s|sell|sold|sale)$/i, "sell"],
  [/^sip/i, "sip"],
  [/^div/i, "dividend"],
  [/^bonus/i, "bonus"],
  [/^split/i, "split"],
  [/^redeem|^redemption/i, "redemption"],
  [/^interest/i, "interest"],
  [/^deposit/i, "deposit"],
  [/^withdraw/i, "withdrawal"],
];

const KIND_WORDS: [RegExp, InstrumentKind][] = [
  [/^(stock|equity|share|direct equit)/i, "stock"],
  [/^etfs?\b/i, "etf"],
  [/^(mf\b|mutual|funds?\b)/i, "mf"],
  [/^gold/i, "gold"],
  [/^(bonds?|ncds?)\b/i, "bond"],
  [/^(fds?\b|fixed|deposits?$)/i, "fd"],
  [/^(rds?\b|recurring)/i, "rd"],
  [/^(cash|savings?|bank balance)/i, "cash"],
];

export function kindFromText(text: string): InstrumentKind | null {
  const t = text.trim();
  return KIND_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

export interface SectionRow {
  line: number;
  label: string;
  kind: InstrumentKind;
}

/**
 * Turn mapped CSV rows into transactions. A row with only a name (e.g.
 * "Mutual funds", "RD") is read as a section heading that sets the instrument
 * type of the rows below it, as personal spreadsheets often group that way.
 */
export function applyMapping(rows: string[][], m: CsvMapping): { rows: ParsedRow[]; errors: RowError[]; sections: SectionRow[] } {
  const out: ParsedRow[] = [];
  const errors: RowError[] = [];
  const sections: SectionRow[] = [];
  let sectionKind: InstrumentKind | null = null;
  const get = (row: string[], f: CsvField) => {
    const i = m.columns[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  for (let r = m.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;
    const name = get(row, "name") || get(row, "symbol");
    const dateText = get(row, "date");
    if (!name && !dateText) continue; // blank or side-table rows
    const numeric = (["qty", "price", "amount"] as CsvField[]).some((f) => parseAmount(get(row, f)) !== null);
    if (!dateText && !numeric) {
      const k = kindFromText(name);
      if (k) {
        sectionKind = k;
        sections.push({ line, label: name, kind: k });
        continue;
      }
    }
    if (!name) {
      errors.push({ line, reason: "No name or symbol", raw: row });
      continue;
    }
    const date = parseDateFlexible(dateText, m.dateOrder);
    if (!date) {
      errors.push({ line, reason: dateText ? `Unrecognised date "${dateText}"` : "Missing date", raw: row });
      continue;
    }
    const typeText = get(row, "type");
    const type = typeText ? TYPE_WORDS.find(([re]) => re.test(typeText))?.[1] : m.defaultType;
    if (!type) {
      errors.push({ line, reason: `Unknown transaction type "${typeText}"`, raw: row });
      continue;
    }
    const kindText = get(row, "kind");
    const kind = (kindText && kindFromText(kindText)) || sectionKind || m.defaultKind;
    const qtyRaw = parseAmount(get(row, "qty"));
    const priceRaw = parseAmount(get(row, "price"));
    const amountRaw = parseAmount(get(row, "amount"));
    const chargesRaw = parseAmount(get(row, "charges"));
    const qty = qtyRaw === null ? undefined : roundQty(Math.abs(qtyRaw));
    let price = priceRaw === null ? undefined : Math.abs(priceRaw);
    let amount: Paise | undefined = amountRaw === null ? undefined : toPaise(Math.abs(amountRaw));
    const tradeLike = ["buy", "sell", "sip", "redemption"].includes(type);
    if (tradeLike) {
      if (!qty) {
        errors.push({ line, reason: "Missing quantity", raw: row });
        continue;
      }
      if (amount === undefined && price !== undefined) amount = Math.round(qty * price * 100);
      if (price === undefined && amount !== undefined) price = amount / 100 / qty;
      if (amount === undefined || price === undefined) {
        errors.push({ line, reason: "Need a price or an amount", raw: row });
        continue;
      }
    } else if (type === "bonus" || type === "split") {
      if (!qty) {
        errors.push({ line, reason: type === "split" ? "Split needs a ratio in the quantity column" : "Bonus needs a quantity", raw: row });
        continue;
      }
      amount = 0;
    } else if (amount === undefined) {
      errors.push({ line, reason: "Missing amount", raw: row });
      continue;
    }
    out.push({
      line,
      date,
      name: name.replace(/\s+/g, " ").trim(),
      symbol: get(row, "symbol").toUpperCase() || undefined,
      amfiCode: get(row, "amfiCode") || undefined,
      kind,
      type,
      qty,
      price,
      amount: amount ?? 0,
      charges: chargesRaw === null ? undefined : toPaise(Math.abs(chargesRaw)),
    });
  }
  return { rows: out, errors, sections };
}

export function normalizeName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\b(ltd|limited|the|pvt|private)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}
