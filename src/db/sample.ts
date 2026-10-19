import { addDays, addMonths, daysBetween, monthEnd, monthKey, todayISO, withDay } from "../domain/dates";
import { toPaise } from "../domain/money";
import type {
  Instrument,
  InstrumentDetails,
  ISODate,
  Liability,
  LookThrough,
  PricePoint,
  Transaction,
  TxnType,
} from "../domain/types";
import { defaultsForKind } from "../domain/types";
import { db, nowISO, saveSettings } from "./db";

/**
 * Demo portfolio. Everything here is fictional: quantities, prices and
 * dates are generated relative to today, and every record is tagged
 * `sample` so "Clear sample data" removes exactly these rows.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Walk {
  priceOn(date: ISODate): number;
}

/** Deterministic monthly random walk, linearly interpolated between month ends. */
function walk(seed: number, start: ISODate, p0: number, annualDrift: number, monthlyVol: number, months: number): Walk {
  const rnd = mulberry32(seed);
  const pts: { date: ISODate; p: number }[] = [{ date: start, p: p0 }];
  let p = p0;
  for (let i = 1; i <= months + 1; i++) {
    const z = (rnd() + rnd() + rnd() - 1.5) * 2; // ≈ N(0,1)
    p = p * Math.exp(annualDrift / 12 + monthlyVol * z);
    pts.push({ date: addMonths(start, i), p });
  }
  return {
    priceOn(date) {
      if (date <= pts[0]!.date) return pts[0]!.p;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (date <= b.date) {
          const f = daysBetween(a.date, date) / Math.max(1, daysBetween(a.date, b.date));
          return a.p + (b.p - a.p) * f;
        }
      }
      return pts[pts.length - 1]!.p;
    },
  };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export async function loadSampleData(asOf: ISODate = todayISO()): Promise<void> {
  const created = nowISO();
  const instruments: Instrument[] = [];
  const txns: Transaction[] = [];
  const prices: PricePoint[] = [];
  let n = 0;
  const id = (p: string) => `sample-${p}`;

  function add(key: string, name: string, details: InstrumentDetails, extra: Partial<Instrument> = {}): string {
    const iid = id(key);
    instruments.push({ id: iid, name, kind: details.kind, ...defaultsForKind(details.kind), details, sample: true, createdAt: created, ...extra });
    return iid;
  }
  function t(instrumentId: string, type: TxnType, date: ISODate, f: Partial<Transaction>) {
    n++;
    txns.push({
      id: `sample-t${n}`,
      instrumentId,
      date,
      type,
      amount: 0,
      source: "sample",
      createdAt: new Date(Date.parse(created) + n).toISOString(),
      ...f,
    });
  }
  function trade(iid: string, type: "buy" | "sip" | "sell", date: ISODate, qty: number, price: number, charges = 0) {
    t(iid, type, date, { qty, price: r4(price), amount: Math.round(qty * r4(price) * 100), charges: toPaise(charges) });
  }
  function priceSeries(iid: string, w: Walk, from: ISODate) {
    let mk = monthKey(from);
    while (mk < monthKey(asOf)) {
      const d = monthEnd(mk);
      prices.push({ instrumentId: iid, date: d, price: r4(w.priceOn(d)), source: "sample", fetchedAt: `${d}T18:00:00.000Z` });
      mk = monthKey(addMonths(`${mk}-01`, 1));
    }
    const last = lastWeekday(asOf);
    const prev = lastWeekday(addDays(last, -1));
    const pPrev = w.priceOn(prev);
    const pLast = w.priceOn(last) * 1.004; // small up day for the demo
    prices.push({ instrumentId: iid, date: prev, price: r4(pPrev), source: "sample", fetchedAt: `${prev}T18:00:00.000Z` });
    prices.push({ instrumentId: iid, date: last, price: r4(pLast), prevClose: r4(pPrev), source: "sample", fetchedAt: `${last}T18:00:00.000Z` });
  }

  const start = addMonths(asOf, -30);

  // --- Mutual funds with SIPs -------------------------------------------
  const sipFunds = [
    { key: "ppfas", name: "Parag Parikh Flexi Cap Fund – Direct Growth", code: "122639", seg: "flexi" as const, p0: 52, drift: 0.16, sip: 10000, day: 5, months: 30 },
    { key: "uti50", name: "UTI Nifty 50 Index Fund – Direct Growth", code: "120716", seg: "index" as const, p0: 128, drift: 0.12, sip: 5000, day: 10, months: 24, index: "NIFTY 50" },
    { key: "mid", name: "Motilal Oswal Midcap Fund – Direct Growth", code: "127042", seg: "mid" as const, p0: 64, drift: 0.2, sip: 3000, day: 15, months: 14 },
  ];
  for (const [i, f] of sipFunds.entries()) {
    const sipStart = withDay(addMonths(asOf, -f.months), f.day);
    const iid = add(
      f.key,
      f.name,
      { kind: "mf", amfiCode: f.code, category: "Equity", sip: { amount: toPaise(f.sip), day: f.day, start: sipStart } },
      { segment: f.seg, trackingIndex: f.index },
    );
    const w = walk(11 + i, start, f.p0, f.drift, 0.045, 32);
    for (let m = 0; m <= f.months; m++) {
      const d = withDay(addMonths(sipStart, m), f.day);
      if (d > asOf) break;
      const p = w.priceOn(d);
      const qty = Math.floor((f.sip / p) * 1000) / 1000;
      t(iid, "sip", d, { qty, price: r4(p), amount: toPaise(f.sip) });
    }
    priceSeries(iid, w, start);
  }

  // --- ETF duplicating the index fund (clutter demo) ---------------------
  const niftybees = add("niftybees", "Nippon India ETF Nifty BeES", { kind: "etf", exchange: "NSE", symbol: "NIFTYBEES" }, { segment: "index", trackingIndex: "NIFTY 50" });
  {
    const w = walk(21, start, 205, 0.12, 0.04, 32);
    trade(niftybees, "buy", addMonths(asOf, -20), 40, w.priceOn(addMonths(asOf, -20)), 15.93);
    trade(niftybees, "buy", addMonths(asOf, -7), 25, w.priceOn(addMonths(asOf, -7)), 11.2);
    priceSeries(niftybees, w, start);
  }

  // --- Direct stocks ------------------------------------------------------
  const stocks = [
    { key: "hdfcbank", name: "HDFC Bank", sym: "HDFCBANK", sector: "Financials", p0: 1450, drift: 0.1, buys: [[-28, 12], [-15, 8]] },
    { key: "infy", name: "Infosys", sym: "INFY", sector: "IT", p0: 1400, drift: 0.06, buys: [[-26, 10], [-9, 5]] },
    { key: "itc", name: "ITC", sym: "ITC", sector: "FMCG", p0: 380, drift: 0.08, buys: [[-29, 60], [-11, 30]], sell: [-3, 40] },
    { key: "sbin", name: "State Bank of India", sym: "SBIN", sector: "Financials", p0: 560, drift: 0.14, buys: [[-22, 20]] },
    { key: "tmpv", name: "Tata Motors", sym: "TATAMOTORS", sector: "Automobile", p0: 640, drift: 0.02, buys: [[-13, 15]] },
    { key: "irctc", name: "IRCTC", sym: "IRCTC", sector: "Consumer Services", p0: 820, drift: 0.03, buys: [[-5, 3]] },
  ] as const;
  for (const [i, s] of stocks.entries()) {
    const iid = add(s.key, s.name, { kind: "stock", exchange: "NSE", symbol: s.sym }, { segment: "direct", sector: s.sector });
    const w = walk(31 + i, start, s.p0, s.drift, 0.06, 32);
    for (const [mo, qty] of s.buys) {
      const d = lastWeekday(addMonths(asOf, mo));
      const p = w.priceOn(d);
      trade(iid, "buy", d, qty, p, Math.max(5, qty * p * 0.0012));
    }
    if ("sell" in s && s.sell) {
      const [mo, qty] = s.sell;
      const d = lastWeekday(addMonths(asOf, mo));
      const p = w.priceOn(d) * 1.18;
      trade(iid, "sell", d, qty, p, Math.max(5, qty * p * 0.0012));
    }
    if (s.key === "itc") t(iid, "dividend", lastWeekday(addMonths(asOf, -4)), { amount: toPaise(6.5 * 50) });
    priceSeries(iid, w, start);
  }

  // --- Gold ---------------------------------------------------------------
  const goldbees = add("goldbees", "Nippon India ETF Gold BeES", { kind: "gold", form: "etf", exchange: "NSE", symbol: "GOLDBEES" });
  {
    const w = walk(41, start, 52, 0.18, 0.03, 32);
    trade(goldbees, "buy", lastWeekday(addMonths(asOf, -18)), 300, w.priceOn(addMonths(asOf, -18)), 20);
    trade(goldbees, "buy", lastWeekday(addMonths(asOf, -6)), 150, w.priceOn(addMonths(asOf, -6)), 12);
    priceSeries(goldbees, w, start);
  }
  const coin = add("coin", "Gold coin 24K", { kind: "gold", form: "physical", purity: "24K 999" }, { taxClass: "unlistedOther" });
  trade(coin, "buy", addMonths(asOf, -27), 10, 5450);

  // --- Debt ---------------------------------------------------------------
  const rdStart = withDay(addMonths(asOf, -10), 7);
  const rd = add("rd", "SBI Recurring Deposit", { kind: "rd", bank: "SBI", monthlyAmount: toPaise(5000), ratePct: 6.8, start: rdStart, tenureMonths: 24, penaltyPct: 1 });
  for (let m = 0; m <= 10; m++) {
    const d = withDay(addMonths(rdStart, m), 7);
    if (d <= asOf) t(rd, "rd_instalment", d, { amount: toPaise(5000) });
  }
  const fdStart = addDays(addMonths(asOf, -12), 50);
  const fd = add("fd", "HDFC Bank FD (1 year)", {
    kind: "fd",
    bank: "HDFC Bank",
    ratePct: 7.25,
    start: fdStart,
    maturity: addMonths(fdStart, 12),
    payout: "cumulative",
    penaltyPct: 1,
    sweepIn: false,
  });
  t(fd, "deposit", fdStart, { amount: toPaise(100000) });

  const ncdStart = addMonths(asOf, -9);
  const ncd = add("ncd", "Muthoot Finance NCD 9.0% 2027", {
    kind: "bond",
    issuer: "Muthoot Finance",
    faceValue: 1000,
    couponPct: 9,
    payout: "quarterly",
    maturity: addMonths(ncdStart, 24),
    rating: "AA+",
    tdsPct: 10,
    listed: true,
  });
  trade(ncd, "buy", ncdStart, 25, 1000);
  for (let q = 1; q <= 3; q++) {
    const d = addMonths(addMonths(ncdStart, 24), -24 + q * 3);
    if (d <= asOf) t(ncd, "coupon", d, { amount: toPaise(25 * 1000 * 0.09 / 4), tds: toPaise(25 * 1000 * 0.09 / 4 * 0.1) });
  }

  // --- Cash / emergency fund ---------------------------------------------
  const sb = add("savings", "HDFC Savings Account", { kind: "cash", bank: "HDFC Bank", account: "savings", ratePct: 3 });
  t(sb, "deposit", addMonths(asOf, -30), { amount: toPaise(120000) });
  t(sb, "interest", addMonths(asOf, -6), { amount: toPaise(1800) });
  t(sb, "withdrawal", addMonths(asOf, -2), { amount: toPaise(15000) });
  const sweep = add("sweep", "ICICI Sweep-in FD", { kind: "cash", bank: "ICICI Bank", account: "sweep", ratePct: 6.5 });
  t(sweep, "deposit", addMonths(asOf, -14), { amount: toPaise(100000) });

  // --- Commitment outside portfolio ---------------------------------------
  const cmStart = withDay(addMonths(asOf, -6), 12);
  const jewel = add(
    "jewel",
    "Jewellery savings plan",
    { kind: "commitment", beneficiary: "Amma", monthlyAmount: toPaise(3000), day: 12, start: cmStart, end: addMonths(cmStart, 10) },
    { assetClass: "gold" },
  );
  for (let m = 0; m <= 6; m++) {
    const d = withDay(addMonths(cmStart, m), 12);
    if (d <= asOf) t(jewel, "commitment_payment", d, { amount: toPaise(3000) });
  }

  // --- Look-through snapshots -------------------------------------------
  const month = monthKey(asOf);
  const lookThrough: LookThrough[] = [
    {
      instrumentId: id("ppfas"),
      month,
      holdings: [
        { name: "HDFC Bank", sector: "Financials", weightPct: 8.1 },
        { name: "Bajaj Holdings & Investment", sector: "Financials", weightPct: 6.4 },
        { name: "Power Grid Corporation", sector: "Utilities", weightPct: 6 },
        { name: "ITC", sector: "FMCG", weightPct: 5.2 },
        { name: "Coal India", sector: "Energy", weightPct: 5 },
        { name: "ICICI Bank", sector: "Financials", weightPct: 4.8 },
        { name: "Alphabet Inc", sector: "Communication (US)", weightPct: 4.1 },
        { name: "Maruti Suzuki", sector: "Automobile", weightPct: 3.6 },
      ],
    },
    {
      instrumentId: id("uti50"),
      month,
      holdings: [
        { name: "HDFC Bank", sector: "Financials", weightPct: 13 },
        { name: "ICICI Bank", sector: "Financials", weightPct: 8.9 },
        { name: "Reliance Industries", sector: "Energy", weightPct: 8.4 },
        { name: "Infosys", sector: "IT", weightPct: 5.1 },
        { name: "Bharti Airtel", sector: "Telecom", weightPct: 4.6 },
        { name: "ITC", sector: "FMCG", weightPct: 3.6 },
      ],
    },
  ];

  const liabilities: Liability[] = [
    { id: id("loan"), name: "Two-wheeler loan", emi: toPaise(3500), emiDay: 5, endDate: withDay(addMonths(asOf, 5), 5), sample: true },
  ];

  await db.transaction("rw", [db.instruments, db.txns, db.prices, db.lookThrough, db.liabilities], async () => {
    await db.instruments.bulkPut(instruments);
    await db.txns.bulkPut(txns);
    await db.prices.bulkPut(prices);
    await db.lookThrough.bulkPut(lookThrough);
    await db.liabilities.bulkPut(liabilities);
  });
  await saveSettings({ sampleLoaded: true });
}

export async function clearSampleData(): Promise<void> {
  await db.transaction("rw", [db.instruments, db.txns, db.prices, db.lookThrough, db.liabilities], async () => {
    const ids = (await db.instruments.toArray()).filter((i) => i.sample).map((i) => i.id);
    await db.txns.where("instrumentId").anyOf(ids).delete();
    await db.txns.filter((t) => t.source === "sample").delete();
    await db.prices.where("instrumentId").anyOf(ids).delete();
    await db.lookThrough.where("instrumentId").anyOf(ids).delete();
    await db.instruments.bulkDelete(ids);
    const loans = (await db.liabilities.toArray()).filter((l) => l.sample).map((l) => l.id);
    await db.liabilities.bulkDelete(loans);
  });
  await saveSettings({ sampleLoaded: false });
}

function lastWeekday(d: ISODate): ISODate {
  let x = d;
  for (let i = 0; i < 3; i++) {
    const wd = new Date(`${x}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) return x;
    x = addDays(x, -1);
  }
  return x;
}
