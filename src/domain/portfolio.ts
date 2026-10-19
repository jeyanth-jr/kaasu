import { addMonths, daysBetween, monthEnd, monthKey, addMonthsToKey, yearFrac } from "./dates";
import { matchFifo, openCost, openQty, sortTxns, type LotBook } from "./lots";
import { valueOf } from "./money";
import type {
  AssetClass,
  Instrument,
  ISODate,
  Paise,
  PricePoint,
  Settings,
  Transaction,
} from "./types";
import { isMarketKind } from "./types";
import { xirrOrNull, type CashFlow } from "./xirr";

// ---------------------------------------------------------------------------
// Price index

export class PriceIndex {
  private byId = new Map<string, PricePoint[]>();

  constructor(points: PricePoint[]) {
    for (const p of points) {
      const arr = this.byId.get(p.instrumentId) ?? [];
      arr.push(p);
      this.byId.set(p.instrumentId, arr);
    }
    for (const arr of this.byId.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  series(id: string): PricePoint[] {
    return this.byId.get(id) ?? [];
  }

  /** Latest price on or before `date`. */
  at(id: string, date: ISODate): PricePoint | null {
    const arr = this.byId.get(id);
    if (!arr || arr.length === 0) return null;
    let lo = 0;
    let hi = arr.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]!.date <= date) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 ? arr[ans]! : null;
  }

  /** The price point before `point` (for day change when prevClose is absent). */
  before(id: string, date: ISODate): PricePoint | null {
    const arr = this.byId.get(id);
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i]!.date < date) return arr[i]!;
    return null;
  }

  /** Physical gold priced per gram from a gold ETF series. */
  withDerivedGold(instruments: Instrument[], settings: Settings): PriceIndex {
    if (settings.goldPerGramSource !== "etf" || !settings.goldEtfInstrumentId || !settings.goldGramsPerEtfUnit) return this;
    const src = this.series(settings.goldEtfInstrumentId);
    if (src.length === 0) return this;
    const g = settings.goldGramsPerEtfUnit;
    const extra: PricePoint[] = [];
    for (const inst of instruments) {
      if (inst.details.kind === "gold" && inst.details.form === "physical") {
        for (const p of src) {
          extra.push({
            instrumentId: inst.id,
            date: p.date,
            price: p.price / g,
            prevClose: p.prevClose !== undefined ? p.prevClose / g : undefined,
            source: "derived",
            fetchedAt: p.fetchedAt,
          });
        }
      }
    }
    const all: PricePoint[] = [];
    for (const arr of this.byId.values()) all.push(...arr);
    // Derived points replace manual ones for those instruments.
    const derivedIds = new Set(extra.map((e) => e.instrumentId));
    return new PriceIndex([...all.filter((p) => !derivedIds.has(p.instrumentId)), ...extra]);
  }
}

// ---------------------------------------------------------------------------
// Holdings

export type ValueSource = "price" | "lastTrade" | "cost" | "accrual" | "balance" | "paid";

export interface Holding {
  instrument: Instrument;
  book: LotBook | null;
  qty: number;
  /** Cost basis of what is still held (principal for deposits). */
  invested: Paise;
  value: Paise;
  valueSource: ValueSource;
  price: PricePoint | null;
  priceAgeDays: number | null;
  dayChange: Paise | null;
  unrealized: Paise;
  realized: Paise;
  income: Paise;
  tdsPaid: Paise;
  xirr: number | null;
  flows: CashFlow[];
  closed: boolean;
  maturity: ISODate | null;
  /** What breaking a deposit today would roughly return (after penalty). */
  prematureValue: Paise | null;
  firstDate: ISODate | null;
  warnings: string[];
}

function sumAmt(txns: Transaction[], types: Transaction["type"][]): Paise {
  return txns.filter((t) => types.includes(t.type)).reduce((s, t) => s + t.amount, 0);
}

/** Quarterly-compounded accrual of a dated amount (Indian bank FD/RD convention). */
function accrue(amount: Paise, ratePct: number, from: ISODate, to: ISODate): number {
  if (to <= from) return amount;
  const y = yearFrac(from, to);
  return amount * Math.pow(1 + ratePct / 400, 4 * y);
}

export function depositMaturity(inst: Instrument): ISODate | null {
  const d = inst.details;
  if (d.kind === "rd") return addMonths(d.start, d.tenureMonths);
  if (d.kind === "fd") return d.maturity;
  if (d.kind === "bond") return d.maturity;
  if (d.kind === "commitment") return d.end ?? null;
  return null;
}

function cashFlowsFor(inst: Instrument, txns: Transaction[]): CashFlow[] {
  const cumulative = inst.details.kind === "fd" && inst.details.payout === "cumulative";
  const flows: CashFlow[] = [];
  for (const t of txns) {
    const c = t.charges ?? 0;
    switch (t.type) {
      case "buy":
      case "sip":
        flows.push({ date: t.date, amount: -(t.amount + c) });
        break;
      case "sell":
      case "redemption":
        flows.push({ date: t.date, amount: t.amount - c });
        break;
      case "deposit":
      case "rd_instalment":
      case "commitment_payment":
        flows.push({ date: t.date, amount: -t.amount });
        break;
      case "withdrawal":
      case "maturity":
        flows.push({ date: t.date, amount: t.amount });
        break;
      case "interest":
        // Cumulative deposits reinvest interest; it shows up in the accrued value instead.
        if (!cumulative && inst.kind !== "rd" && inst.kind !== "cash") flows.push({ date: t.date, amount: t.amount });
        break;
      case "dividend":
      case "coupon":
        flows.push({ date: t.date, amount: t.amount });
        break;
      case "fee":
        flows.push({ date: t.date, amount: -t.amount });
        break;
      default:
        break;
    }
  }
  return flows;
}

export interface HoldingContext {
  prices: PriceIndex;
  asOf: ISODate;
}

export function buildHolding(inst: Instrument, allTxns: Transaction[], ctx: HoldingContext): Holding {
  const txns = sortTxns(allTxns.filter((t) => t.date <= ctx.asOf));
  const warnings: string[] = [];
  const flows = cashFlowsFor(inst, txns);
  const income = sumAmt(txns, ["dividend", "coupon"]) + (inst.kind === "fd" && inst.details.kind === "fd" && inst.details.payout !== "cumulative" ? sumAmt(txns, ["interest"]) : 0);
  const tdsPaid = txns.reduce((s, t) => s + (t.tds ?? 0), 0);
  const firstDate = txns[0]?.date ?? null;
  const maturity = depositMaturity(inst);

  const base = {
    instrument: inst,
    income,
    tdsPaid,
    firstDate,
    maturity,
    warnings,
    prematureValue: null as Paise | null,
  };

  if (isMarketKind(inst.kind)) {
    const book = matchFifo(txns);
    for (const w of book.warnings) warnings.push(w.message);
    const qty = openQty(book);
    const invested = openCost(book);
    const realized = book.realized.reduce((s, r) => s + r.gain, 0);
    const price = ctx.prices.at(inst.id, ctx.asOf);
    let value: Paise;
    let valueSource: ValueSource;
    if (price) {
      value = valueOf(qty, price.price);
      valueSource = "price";
    } else {
      const lastTrade = [...txns].reverse().find((t) => (t.type === "buy" || t.type === "sip" || t.type === "sell") && t.price);
      if (lastTrade?.price) {
        value = valueOf(qty, lastTrade.price);
        valueSource = "lastTrade";
      } else {
        value = invested;
        valueSource = "cost";
      }
    }
    let dayChange: Paise | null = null;
    if (price && qty > 0) {
      const prev = price.prevClose ?? ctx.prices.before(inst.id, price.date)?.price;
      if (prev !== undefined) dayChange = valueOf(qty, price.price) - valueOf(qty, prev);
    }
    const closed = qty <= 1e-6;
    const allFlows = !closed && value > 0 ? [...flows, { date: ctx.asOf, amount: value }] : flows;
    return {
      ...base,
      book,
      qty,
      invested,
      value: closed ? 0 : value,
      valueSource,
      price,
      priceAgeDays: price ? daysBetween(price.date, ctx.asOf) : null,
      dayChange,
      unrealized: closed ? 0 : value - invested,
      realized,
      xirr: xirrOrNull(allFlows),
      flows: allFlows,
      closed,
    };
  }

  const d = inst.details;
  let invested = 0;
  let value = 0;
  let valueSource: ValueSource = "balance";
  let realized = 0;
  let closed = false;

  if (d.kind === "rd" || d.kind === "fd") {
    const ins = txns.filter((t) => t.type === "deposit" || t.type === "rd_instalment");
    const outs = txns.filter((t) => t.type === "withdrawal" || t.type === "maturity");
    const principal = ins.reduce((s, t) => s + t.amount, 0);
    const end = maturity && maturity < ctx.asOf ? maturity : ctx.asOf;
    const cumulative = d.kind === "rd" || d.payout === "cumulative";
    const grow = (rate: number) =>
      cumulative
        ? ins.reduce((s, t) => s + accrue(t.amount, rate, t.date, end), 0) -
          outs.reduce((s, t) => s + accrue(t.amount, rate, t.date, end), 0)
        : principal - outs.reduce((s, t) => s + t.amount, 0);
    closed = txns.some((t) => t.type === "maturity");
    if (closed) {
      const proceeds = outs.reduce((s, t) => s + t.amount, 0);
      realized = proceeds - principal;
      invested = 0;
      value = 0;
    } else {
      invested = principal - outs.reduce((s, t) => s + t.amount, 0);
      value = Math.max(0, Math.round(grow(d.ratePct)));
      valueSource = cumulative ? "accrual" : "balance";
      if (maturity && ctx.asOf < maturity && d.penaltyPct > 0) {
        base.prematureValue = Math.max(0, Math.round(grow(Math.max(0, d.ratePct - d.penaltyPct))));
      }
    }
  } else if (d.kind === "cash") {
    const bal =
      sumAmt(txns, ["deposit", "interest", "balance_adjust"]) - sumAmt(txns, ["withdrawal", "fee"]);
    invested = sumAmt(txns, ["deposit", "balance_adjust"]) - sumAmt(txns, ["withdrawal"]);
    value = bal;
    valueSource = "balance";
  } else if (d.kind === "commitment") {
    const paid = sumAmt(txns, ["commitment_payment"]);
    invested = paid;
    value = paid;
    valueSource = "paid";
    closed = !!d.end && d.end < ctx.asOf;
  }

  const allFlows = !closed && value > 0 ? [...flows, { date: ctx.asOf, amount: value }] : flows;
  return {
    ...base,
    book: null,
    qty: 0,
    invested,
    value,
    valueSource,
    price: null,
    priceAgeDays: null,
    dayChange: null,
    unrealized: closed ? 0 : value - invested,
    realized,
    xirr: d.kind === "cash" || d.kind === "commitment" ? null : xirrOrNull(allFlows),
    flows: allFlows,
    closed,
  };
}

// ---------------------------------------------------------------------------
// Portfolio summary

export interface Portfolio {
  asOf: ISODate;
  holdings: Holding[];
  /** Holdings counted in net worth (commitments only when toggled on). */
  counted: Holding[];
  netWorth: Paise;
  invested: Paise;
  unrealized: Paise;
  realized: Paise;
  income: Paise;
  dayChange: Paise;
  dayChangeBase: Paise;
  xirr: number | null;
  byClass: Record<AssetClass, Paise>;
  commitmentsPaid: Paise;
  stalePrices: Holding[];
}

export function countsInNetWorth(inst: Instrument, settings: Settings): boolean {
  if (inst.kind === "commitment") return settings.includeCommitments;
  return true;
}

export function buildPortfolio(input: {
  instruments: Instrument[];
  txns: Transaction[];
  prices: PricePoint[];
  settings: Settings;
  asOf: ISODate;
}): Portfolio {
  const prices = new PriceIndex(input.prices).withDerivedGold(input.instruments, input.settings);
  const byInst = new Map<string, Transaction[]>();
  for (const t of input.txns) {
    const arr = byInst.get(t.instrumentId) ?? [];
    arr.push(t);
    byInst.set(t.instrumentId, arr);
  }
  const holdings = input.instruments
    .filter((i) => !i.archived)
    .map((i) => buildHolding(i, byInst.get(i.id) ?? [], { prices, asOf: input.asOf }));
  const counted = holdings.filter((h) => countsInNetWorth(h.instrument, input.settings));
  const byClass: Record<AssetClass, Paise> = { equity: 0, debt: 0, gold: 0, cash: 0, other: 0 };
  let netWorth = 0;
  let invested = 0;
  let unrealized = 0;
  let realized = 0;
  let income = 0;
  let dayChange = 0;
  let dayChangeBase = 0;
  const flows: CashFlow[] = [];
  for (const h of counted) {
    netWorth += h.value;
    invested += h.invested;
    unrealized += h.unrealized;
    realized += h.realized;
    income += h.income;
    byClass[h.instrument.assetClass] += h.value;
    if (h.dayChange !== null && h.priceAgeDays !== null && h.priceAgeDays <= 4) {
      dayChange += h.dayChange;
      dayChangeBase += h.value - h.dayChange;
    }
    if (h.instrument.kind !== "cash" && h.instrument.kind !== "commitment") flows.push(...h.flows);
  }
  const commitmentsPaid = holdings.filter((h) => h.instrument.kind === "commitment").reduce((s, h) => s + h.value, 0);
  return {
    asOf: input.asOf,
    holdings,
    counted,
    netWorth,
    invested,
    unrealized,
    realized,
    income,
    dayChange,
    dayChangeBase,
    xirr: xirrOrNull(flows),
    byClass,
    commitmentsPaid,
    stalePrices: holdings.filter((h) => !h.closed && h.qty > 0 && (h.priceAgeDays === null || h.priceAgeDays > 7)),
  };
}

// ---------------------------------------------------------------------------
// Net worth over time (derived, month-ends + today)

export interface SeriesPoint {
  date: ISODate;
  netWorth: Paise;
  invested: Paise;
  /** True if some holdings were valued at cost/last trade due to missing prices. */
  estimated: boolean;
}

export function netWorthSeries(input: {
  instruments: Instrument[];
  txns: Transaction[];
  prices: PricePoint[];
  settings: Settings;
  asOf: ISODate;
  maxPoints?: number;
}): SeriesPoint[] {
  if (input.txns.length === 0) return [];
  const prices = new PriceIndex(input.prices).withDerivedGold(input.instruments, input.settings);
  const first = input.txns.reduce((m, t) => (t.date < m ? t.date : m), input.asOf);
  const dates: ISODate[] = [];
  let mk = monthKey(first);
  const lastMk = monthKey(input.asOf);
  while (mk < lastMk) {
    dates.push(monthEnd(mk));
    mk = addMonthsToKey(mk, 1);
  }
  dates.push(input.asOf);
  const max = input.maxPoints ?? 120;
  const sampled = dates.length > max ? dates.filter((_, i) => i % Math.ceil(dates.length / max) === 0 || i === dates.length - 1) : dates;
  const byInst = new Map<string, Transaction[]>();
  for (const t of input.txns) {
    const arr = byInst.get(t.instrumentId) ?? [];
    arr.push(t);
    byInst.set(t.instrumentId, arr);
  }
  const insts = input.instruments.filter((i) => !i.archived && countsInNetWorth(i, input.settings));
  return sampled.map((date) => {
    let netWorth = 0;
    let invested = 0;
    let estimated = false;
    for (const inst of insts) {
      const h = buildHolding(inst, byInst.get(inst.id) ?? [], { prices, asOf: date });
      netWorth += h.value;
      invested += h.invested;
      if (h.qty > 0 && h.valueSource !== "price") estimated = true;
    }
    return { date, netWorth, invested, estimated };
  });
}
