import { describe, expect, it } from "vitest";
import { allocationView, rebalanceWithNewMoney } from "./allocation";
import { analyzeEquity, parseLookThroughPaste } from "./equity";
import { buildPortfolio } from "./portfolio";
import { calendarEvents, defaultPlan, emergencyView, estimateRdMaturity, planView } from "./schedule";
import { txn } from "./test-helpers";
import { DEFAULT_SETTINGS, type Instrument, type PricePoint } from "./types";

function inst(id: string, partial: Partial<Instrument> & Pick<Instrument, "kind" | "details">): Instrument {
  return {
    id,
    name: id,
    assetClass: "equity",
    taxClass: "equity",
    emergencyLayer: "none",
    createdAt: "2024-01-01T00:00:00Z",
    ...partial,
  };
}

const price = (instrumentId: string, date: string, p: number, prevClose?: number): PricePoint => ({
  instrumentId,
  date,
  price: p,
  prevClose,
  source: "manual",
  fetchedAt: `${date}T10:00:00Z`,
});

describe("portfolio valuation", () => {
  it("values market holdings at the latest price with day change", () => {
    const pf = buildPortfolio({
      instruments: [inst("infy", { kind: "stock", details: { kind: "stock", exchange: "NSE", symbol: "INFY" } })],
      txns: [txn("buy", "2024-01-10", { instrumentId: "infy", qty: 10, price: 1500 })],
      prices: [price("infy", "2025-10-17", 1600, 1580)],
      settings: DEFAULT_SETTINGS,
      asOf: "2025-10-19",
    });
    const h = pf.holdings[0]!;
    expect(h.value).toBe(16000_00);
    expect(h.unrealized).toBe(1000_00);
    expect(h.dayChange).toBe(200_00);
    expect(h.priceAgeDays).toBe(2);
    expect(pf.netWorth).toBe(16000_00);
    expect(h.xirr).not.toBeNull();
  });

  it("falls back to last trade price and flags it", () => {
    const pf = buildPortfolio({
      instruments: [inst("x", { kind: "stock", details: { kind: "stock", exchange: "NSE", symbol: "X" } })],
      txns: [txn("buy", "2025-01-10", { instrumentId: "x", qty: 2, price: 50 })],
      prices: [],
      settings: DEFAULT_SETTINGS,
      asOf: "2025-10-19",
    });
    expect(pf.holdings[0]!.valueSource).toBe("lastTrade");
    expect(pf.stalePrices).toHaveLength(1);
  });

  it("accrues an RD with quarterly compounding and estimates the premature value", () => {
    const rd = inst("rd", {
      kind: "rd",
      assetClass: "debt",
      taxClass: "slab",
      emergencyLayer: "second",
      details: { kind: "rd", bank: "SBI", monthlyAmount: 5000_00, ratePct: 7, start: "2025-01-05", tenureMonths: 12, penaltyPct: 1 },
    });
    const txns = Array.from({ length: 10 }, (_, i) =>
      txn("rd_instalment", `2025-${String(i + 1).padStart(2, "0")}-05`, { instrumentId: "rd", amount: 5000_00 }),
    );
    const pf = buildPortfolio({ instruments: [rd], txns, prices: [], settings: DEFAULT_SETTINGS, asOf: "2025-10-19" });
    const h = pf.holdings[0]!;
    expect(h.invested).toBe(50000_00);
    expect(h.value).toBeGreaterThan(50000_00);
    expect(h.value).toBeLessThan(52000_00);
    expect(h.prematureValue).toBeGreaterThan(50000_00);
    expect(h.prematureValue!).toBeLessThan(h.value);
    expect(h.maturity).toBe("2026-01-05");
  });

  it("matches the standard RD maturity formula", () => {
    // ₹1,000/month, 12 months, 7% → ≈ ₹12,465 (published bank calculators)
    const m = estimateRdMaturity(1000_00, 7, 12);
    expect(Math.round(m / 100)).toBeGreaterThanOrEqual(12460);
    expect(Math.round(m / 100)).toBeLessThanOrEqual(12470);
  });

  it("excludes commitments from net worth unless toggled", () => {
    const c = inst("jewel", {
      kind: "commitment",
      assetClass: "other",
      taxClass: "none",
      details: { kind: "commitment", beneficiary: "Amma", monthlyAmount: 3000_00, day: 10, start: "2025-01-10", end: "2025-12-10" },
    });
    const txns = [txn("commitment_payment", "2025-02-10", { instrumentId: "jewel", amount: 3000_00 })];
    const base = { instruments: [c], txns, prices: [], asOf: "2025-10-19" };
    expect(buildPortfolio({ ...base, settings: DEFAULT_SETTINGS }).netWorth).toBe(0);
    expect(buildPortfolio({ ...base, settings: { ...DEFAULT_SETTINGS, includeCommitments: true } }).netWorth).toBe(3000_00);
  });

  it("derives physical gold price from a gold ETF when configured", () => {
    const etf = inst("gbees", { kind: "gold", assetClass: "gold", taxClass: "listedOther", details: { kind: "gold", form: "etf", symbol: "GOLDBEES", exchange: "NSE" } });
    const phys = inst("coin", { kind: "gold", assetClass: "gold", taxClass: "unlistedOther", details: { kind: "gold", form: "physical" } });
    const pf = buildPortfolio({
      instruments: [etf, phys],
      txns: [txn("buy", "2024-01-01", { instrumentId: "coin", qty: 10, price: 6000 })],
      prices: [price("gbees", "2025-10-17", 100)],
      settings: { ...DEFAULT_SETTINGS, goldPerGramSource: "etf", goldEtfInstrumentId: "gbees", goldGramsPerEtfUnit: 0.01 },
      asOf: "2025-10-19",
    });
    expect(pf.holdings[1]!.value).toBe(10000 * 10 * 100);
    expect(pf.holdings[1]!.price?.source).toBe("derived");
  });
});

describe("allocation", () => {
  const bands = [
    { assetClass: "equity" as const, minPct: 75, maxPct: 80 },
    { assetClass: "debt" as const, minPct: 10, maxPct: 15 },
    { assetClass: "gold" as const, minPct: 5, maxPct: 8 },
  ];

  it("flags classes outside their bands", () => {
    const v = allocationView({ equity: 85_00, debt: 10_00, gold: 5_00 }, bands);
    expect(v.rows.find((r) => r.assetClass === "equity")?.status).toBe("above");
    expect(v.rows.find((r) => r.assetClass === "gold")?.status).toBe("within");
  });

  it("directs new money to underweight classes first and splits exactly", () => {
    const plan = rebalanceWithNewMoney({ equity: 8_50_000_00, debt: 1_00_000_00, gold: 50_000_00 }, bands, 50_000_00);
    const total = plan.split.reduce((s, x) => s + x.amount, 0);
    expect(total).toBe(50_000_00);
    expect(plan.split.find((s) => s.assetClass === "equity")).toBeUndefined();
    expect(plan.split.find((s) => s.assetClass === "debt")!.amount).toBeGreaterThan(plan.split.find((s) => s.assetClass === "gold")!.amount);
  });

  it("computes the new money needed to rebalance without selling", () => {
    const values = { equity: 90_00_000, debt: 5_00_000, gold: 5_00_000 }; // T = 1,00,00,000 paise
    const plan = rebalanceWithNewMoney(values, bands, 0);
    // Equity must fall to ≤ 80%: T' ≥ 90L/0.8 = 1.125 × … ⇒ N ≥ 12.5% of T, but debt needs ≥ 10% too.
    const t = 1_00_00_000 + plan.neededToBalance;
    expect(90_00_000 / t).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(plan.neededToBalance).toBeGreaterThanOrEqual(12_50_000);
    // Check feasibility: with N extra, the underweights can reach their mins.
    const needMin = Math.max(0, 0.1 * t - 5_00_000) + Math.max(0, 0.05 * t - 5_00_000);
    expect(needMin).toBeLessThanOrEqual(plan.neededToBalance + 1);
  });
});

describe("equity analysis", () => {
  it("flags duplicate index exposure, small positions and look-through concentration", () => {
    const n1 = inst("n1", { kind: "mf", segment: "index", trackingIndex: "NIFTY 50", details: { kind: "mf", amfiCode: "1" } });
    const n2 = inst("n2", { kind: "etf", segment: "index", trackingIndex: "nifty 50", details: { kind: "etf", exchange: "NSE", symbol: "NIFTYBEES" } });
    const hdfc = inst("hdfc", { kind: "stock", sector: "Financials", name: "HDFC Bank Ltd", details: { kind: "stock", exchange: "NSE", symbol: "HDFCBANK" } });
    const tiny = inst("tiny", { kind: "stock", sector: "IT", name: "Tiny", details: { kind: "stock", exchange: "NSE", symbol: "TINY" } });
    const pf = buildPortfolio({
      instruments: [n1, n2, hdfc, tiny],
      txns: [
        txn("buy", "2024-01-01", { instrumentId: "n1", qty: 100, price: 500 }),
        txn("buy", "2024-01-01", { instrumentId: "n2", qty: 100, price: 250 }),
        txn("buy", "2024-01-01", { instrumentId: "hdfc", qty: 10, price: 1500 }),
        txn("buy", "2024-01-01", { instrumentId: "tiny", qty: 1, price: 1000 }),
      ],
      prices: [],
      settings: DEFAULT_SETTINGS,
      asOf: "2025-10-19",
    });
    const a = analyzeEquity(pf.holdings, [{ instrumentId: "n1", month: "2025-09", holdings: [{ name: "HDFC Bank", sector: "Financials", weightPct: 13 }] }], DEFAULT_SETTINGS);
    const kinds = a.flags.map((f) => f.kind);
    expect(kinds).toContain("duplicate-exposure");
    expect(kinds).toContain("small-position");
    const hdfcExp = a.exposures.find((e) => e.name.startsWith("HDFC"))!;
    expect(hdfcExp.value).toBe(15000_00 + 6500_00); // direct + 13% of ₹50,000
    expect([...hdfcExp.via].sort()).toEqual(["direct", "n1"]);
    expect(kinds).toContain("stock-concentration");
    expect(a.lookThroughCoverage).toBeCloseTo((50000 / 75000) * 100, 6);
  });

  it("parses pasted fund holdings", () => {
    const r = parseLookThroughPaste("HDFC Bank\tFinancials\t9.85%\nICICI Bank, Financials, 7.2\nnot a row\nReliance  Energy  6");
    expect(r.holdings).toEqual([
      { name: "HDFC Bank", sector: "Financials", weightPct: 9.85 },
      { name: "ICICI Bank", sector: "Financials", weightPct: 7.2 },
      { name: "Reliance", sector: "Energy", weightPct: 6 },
    ]);
    expect(r.skipped).toEqual(["not a row"]);
  });
});

describe("calendar, emergency fund and plan", () => {
  const sipFund = inst("sip", {
    kind: "mf",
    details: { kind: "mf", amfiCode: "1", sip: { amount: 5000_00, day: 31, start: "2025-01-31" } },
  });
  const cash = inst("sb", { kind: "cash", assetClass: "cash", taxClass: "none", emergencyLayer: "instant", details: { kind: "cash", bank: "HDFC", account: "savings" } });

  it("schedules SIPs on clamped month ends", () => {
    const ev = calendarEvents({ instruments: [sipFund], holdings: [], liabilities: [], from: "2025-02-01", to: "2025-04-30" });
    expect(ev.map((e) => e.date)).toEqual(["2025-02-28", "2025-03-31", "2025-04-30"]);
  });

  it("lists EMIs up to the end date with a last-EMI marker", () => {
    const ev = calendarEvents({
      instruments: [],
      holdings: [],
      liabilities: [{ id: "l", name: "Bike", emi: 3000_00, emiDay: 5, endDate: "2025-12-05" }],
      from: "2025-10-19",
      to: "2026-03-01",
    });
    expect(ev.filter((e) => e.kind === "emi").map((e) => e.date)).toEqual(["2025-11-05", "2025-12-05"]);
    expect(ev.some((e) => e.kind === "emi-end")).toBe(true);
  });

  it("splits the emergency fund into instant and second layers", () => {
    const pf = buildPortfolio({
      instruments: [cash],
      txns: [txn("deposit", "2025-01-01", { instrumentId: "sb", amount: 1_20_000_00 })],
      prices: [],
      settings: DEFAULT_SETTINGS,
      asOf: "2025-10-19",
    });
    const e = emergencyView(pf.holdings, { ...DEFAULT_SETTINGS, monthlyExpenses: 40_000_00, emergencyMonths: 6 });
    expect(e.instantMonths).toBe(3);
    expect(e.target).toBe(2_40_000_00);
  });

  it("compares planned vs actual and puts unplanned buys in the buffer", () => {
    const other = inst("other", { kind: "stock", details: { kind: "stock", exchange: "NSE", symbol: "X" } });
    const plan = defaultPlan([sipFund, other], { ...DEFAULT_SETTINGS, monthlyBudget: 20_000_00 }, "2025-03");
    expect(plan.lines.map((l) => [l.category, l.planned])).toEqual([
      ["sip", 5000_00],
      ["buffer", 15000_00],
    ]);
    const v = planView(
      plan,
      [txn("sip", "2025-03-31", { instrumentId: "sip", amount: 5000_00 }), txn("buy", "2025-03-10", { instrumentId: "other", amount: 2000_00 })],
      [sipFund, other],
    );
    expect(v.rows.find((r) => r.category === "sip")?.actual).toBe(5000_00);
    expect(v.rows.find((r) => r.category === "buffer")?.actual).toBe(2000_00);
    expect(v.actualTotal).toBe(7000_00);
  });
});
