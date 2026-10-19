import { useMemo, useState } from "react";
import { db, newId, nowISO } from "../db/db";
import { KNOWN_SYMBOLS } from "../data/symbols";
import { confidentKnownMatch, matchExisting } from "../domain/importMatch";
import { CSV_FIELDS, applyMapping, guessMapping, normalizeName, parseCsvText, type CsvField, type CsvMapping, type ParsedRow } from "../domain/csv";
import { formatDate } from "../domain/dates";
import { formatINR, formatQty } from "../domain/money";
import type { Instrument, InstrumentKind, Transaction } from "../domain/types";
import { KIND_LABEL, isMarketKind } from "../domain/types";
import { Badge, Button, Callout, Field, Select, cx } from "./components";
import { useData } from "./data";
import { blankInstrument } from "./InstrumentForm";
import { priceLink } from "../prices/client";

export const TEMPLATE = `Date,Name,Symbol,Type,Qty,Price,Amount,Charges
05/04/2025,Infosys,INFY,Buy,10,1450.50,,15.20
10/04/2025,Parag Parikh Flexi Cap Fund - Direct Growth,,SIP,95.123,52.57,5000,
`;

export function ImportCsv() {
  const { instruments } = useData();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => (rows && mapping ? applyMapping(rows, mapping) : null), [rows, mapping]);
  const matches = useMemo(() => (result ? matchExisting(result.rows, instruments) : new Map<number, Instrument | null>()), [result, instruments]);

  async function onFile(f: File) {
    setDone(null);
    setFileName(f.name);
    const text = await f.text();
    const parsed = parseCsvText(text);
    setRows(parsed);
    setMapping(guessMapping(parsed));
  }

  async function doImport() {
    if (!result || !mapping) return;
    setBusy(true);
    try {
      const batchId = newId("b_");
      const created = nowISO();
      const newInst = new Map<string, Instrument>();
      const txns: Transaction[] = [];
      let n = 0;
      for (const r of result.rows) {
        let inst = matches.get(r.line) ?? newInst.get(`${r.kind}:${normalizeName(r.name)}`) ?? null;
        if (!inst) {
          inst = instrumentFromRow(r, created);
          newInst.set(`${r.kind}:${normalizeName(r.name)}`, inst);
        }
        n++;
        txns.push(txnFromRow(r, inst, batchId, new Date(Date.parse(created) + n).toISOString()));
      }
      await db.transaction("rw", [db.instruments, db.txns, db.imports], async () => {
        await db.instruments.bulkAdd([...newInst.values()]);
        await db.txns.bulkAdd(txns);
        await db.imports.add({ id: batchId, createdAt: created, source: "csv", fileName, rows: txns.length, instrumentIds: [...newInst.values()].map((i) => i.id) });
      });
      const unpriced = [...newInst.values()].filter((i) => priceLink(i) === "missing").length;
      setDone(
        `Imported ${txns.length} transactions${newInst.size ? ` and created ${newInst.size} instruments` : ""}. You can undo this from Transactions.` +
          (unpriced ? ` ${unpriced} holding${unpriced > 1 ? "s" : ""} still need an NSE symbol or AMFI code for automatic prices: use "Link price sources" on Holdings.` : "") +
          " Deposits imported from a spreadsheet need their rate and dates filled in on the holding page.",
      );
      setRows(null);
      setMapping(null);
    } catch (e) {
      setDone(`Import failed, nothing was saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const header = rows && mapping ? rows[mapping.headerRow] ?? [] : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Import trades or holdings from a spreadsheet (save it as CSV first). A holdings sheet with "average price" works too: each row becomes one buy on its date. Rows with only a heading such as "Mutual funds" or "RD" set the type for the rows below.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <a className="inline-flex items-center rounded-xl border border-line px-3.5 py-2 text-sm" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="kaasu-import-template.csv">
          Download template
        </a>
      </div>
      {done && <Callout tone={done.startsWith("Import failed") ? "warn" : "accent"}>{done}</Callout>}

      {rows && mapping && result && (
        <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
          <div className="text-sm font-medium">{fileName} · {rows.length} lines</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Header row">
              {(id) => (
                <Select id={id} value={mapping.headerRow} onChange={(e) => setMapping({ ...guessHeaderAt(rows, Number(e.target.value)), dateOrder: mapping.dateOrder, defaultKind: mapping.defaultKind, defaultType: mapping.defaultType })}>
                  {rows.slice(0, 10).map((r, i) => (
                    <option key={i} value={i}>
                      Line {i + 1}: {r.filter(Boolean).slice(0, 3).join(", ").slice(0, 40)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Date format">
              {(id) => (
                <Select id={id} value={mapping.dateOrder} onChange={(e) => setMapping({ ...mapping, dateOrder: e.target.value as "dmy" })}>
                  <option value="dmy">Day/Month/Year (India)</option>
                  <option value="mdy">Month/Day/Year</option>
                  <option value="ymd">Year-Month-Day</option>
                </Select>
              )}
            </Field>
            <Field label="Default instrument type" hint="Used when a row has no type column or section heading">
              {(id) => (
                <Select id={id} value={mapping.defaultKind} onChange={(e) => setMapping({ ...mapping, defaultKind: e.target.value as InstrumentKind })}>
                  {(["stock", "etf", "mf", "gold", "bond", "fd", "rd", "cash"] as InstrumentKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold tracking-wider text-faint uppercase">Columns</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CSV_FIELDS.map((f) => (
                <Field key={f.field} label={f.label} hint={f.hint}>
                  {(id) => (
                    <Select
                      id={id}
                      value={mapping.columns[f.field] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, columns: { ...mapping.columns, [f.field]: e.target.value === "" ? undefined : Number(e.target.value) } as Record<CsvField, number> })}
                    >
                      <option value="">— not in file —</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="accent">{result.rows.length} ready</Badge>
              {result.errors.length > 0 && <Badge tone="warn">{result.errors.length} skipped</Badge>}
              {result.sections.length > 0 && <span className="text-xs text-muted">Sections: {result.sections.map((s) => `${s.label} → ${KIND_LABEL[s.kind]}`).join(", ")}</span>}
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-sunken">
                  <tr className="text-left text-muted">
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Name</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                    <th className="px-2 py-1.5 font-medium">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((r) => {
                    const m = matches.get(r.line);
                    return (
                      <tr key={r.line} className="border-t border-line">
                        <td className="px-2 py-1 text-faint">{r.line}</td>
                        <td className="px-2 py-1 num whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="max-w-[14rem] truncate px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {KIND_LABEL[r.kind]} · {r.type}
                        </td>
                        <td className="px-2 py-1 text-right num">{r.qty !== undefined ? formatQty(r.qty) : ""}</td>
                        <td className="px-2 py-1 text-right num">{formatINR(r.amount, { decimals: 2 })}</td>
                        <td className="px-2 py-1">{m ? <span className="text-gain">existing</span> : <span className="text-muted">new</span>}</td>
                      </tr>
                    );
                  })}
                  {result.errors.map((e) => (
                    <tr key={`e${e.line}`} className="border-t border-line bg-warn-soft/40">
                      <td className="px-2 py-1 text-faint">{e.line}</td>
                      <td colSpan={6} className={cx("px-2 py-1 text-warn")}>
                        Skipped: {e.reason} <span className="text-faint">({e.raw.filter(Boolean).slice(0, 4).join(" | ")})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (setRows(null), setMapping(null))}>
              Cancel
            </Button>
            <Button variant="primary" disabled={result.rows.length === 0 || busy} onClick={doImport}>
              {busy ? "Importing…" : `Import ${result.rows.length} rows`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function guessHeaderAt(rows: string[][], headerRow: number): CsvMapping {
  const g = guessMapping(rows.slice(headerRow));
  return { ...g, headerRow: headerRow + g.headerRow };
}

function instrumentFromRow(r: ParsedRow, created: string): Instrument {
  const base = blankInstrument(r.kind, r.name);
  const id = newId("i_");
  if (r.kind === "stock" || r.kind === "etf") {
    const known = r.symbol ? KNOWN_SYMBOLS.find((k) => k.symbol === r.symbol) : confidentKnownMatch(r.name);
    return {
      ...base,
      id,
      createdAt: created,
      sector: known?.sector ?? base.sector,
      trackingIndex: known?.trackingIndex,
      details: { kind: r.kind, exchange: "NSE", symbol: r.symbol ?? known?.symbol ?? "" },
    };
  }
  if (r.kind === "mf") return { ...base, id, createdAt: created, details: { kind: "mf", amfiCode: r.amfiCode ?? "" } };
  if (r.kind === "fd" || r.kind === "rd") {
    const d = base.details;
    if (d.kind === "fd") return { ...base, id, createdAt: created, details: { ...d, bank: r.name, start: r.date } };
    if (d.kind === "rd") return { ...base, id, createdAt: created, details: { ...d, bank: r.name, start: r.date, monthlyAmount: r.amount } };
  }
  return { ...base, id, createdAt: created };
}

function txnFromRow(r: ParsedRow, inst: Instrument, batchId: string, createdAt: string): Transaction {
  let type = r.type;
  // A "buy" row in a deposit/cash section is really a deposit.
  if (!isMarketKind(inst.kind) && (type === "buy" || type === "sip")) {
    type = inst.kind === "rd" ? "rd_instalment" : inst.kind === "commitment" ? "commitment_payment" : "deposit";
  }
  const market = isMarketKind(inst.kind);
  return {
    id: newId("t_"),
    instrumentId: inst.id,
    date: r.date,
    type,
    qty: market ? r.qty : undefined,
    price: market ? r.price : undefined,
    amount: r.amount,
    charges: r.charges,
    source: "csv",
    importBatchId: batchId,
    createdAt,
  };
}
