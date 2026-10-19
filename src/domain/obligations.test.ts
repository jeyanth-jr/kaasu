import { describe, expect, it } from "vitest";
import { amortize, buildSchedules, debtSummary, emiFor, endingEvents, firstEmiDate, loanStatus, monthlyLadder, monthsFor, prepaymentImpact, scheduleTotals } from "./obligations";
import { txn } from "./test-helpers";
import type { Instrument, Liability } from "./types";

const rs = (n: number) => n * 100;

describe("EMI maths", () => {
  it("matches the standard reducing-balance formula", () => {
    // ₹10 lakh at 9% for 10 years: ₹12,667.58 (published bank calculators)
    expect(Math.abs(emiFor(rs(1_000_000), 9, 120) - 1266758)).toBeLessThanOrEqual(1);
    expect(emiFor(rs(60_000), 0, 6)).toBe(rs(10_000)); // no-cost EMI
    expect(emiFor(rs(1), 10, 0)).toBe(0);
  });

  it("solves tenure from an EMI, and refuses an EMI that can't cover interest", () => {
    expect(monthsFor(rs(1_000_000), 9, 1266758)).toBe(120);
    expect(monthsFor(rs(60_000), 0, rs(10_000))).toBe(6);
    expect(monthsFor(rs(1_000_000), 12, rs(5_000))).toBeNull(); // interest alone is ₹10,000/month
  });
});

describe("amortisation", () => {
  const base = { balance: rs(500_000), annualPct: 10.5, emi: emiFor(rs(500_000), 10.5, 60), firstDate: "2026-02-05" };

  it("repays exactly the principal, ends at zero and adds up", () => {
    const a = amortize(base);
    expect(a.paysOff).toBe(true);
    expect(a.rows).toHaveLength(60);
    expect(a.rows.reduce((s, r) => s + r.principal, 0)).toBe(base.balance);
    expect(a.rows.at(-1)!.balance).toBe(0);
    expect(a.rows.reduce((s, r) => s + r.interest, 0)).toBe(a.totalInterest);
    expect(a.rows[0]!.interest).toBe(Math.round(base.balance * 0.00875));
    expect(a.rows[0]!.date).toBe("2026-02-05");
    expect(a.rows[59]!.date).toBe("2031-01-05");
    // Last payment is trimmed so the balance never goes negative.
    expect(a.rows.at(-1)!.payment).toBeLessThanOrEqual(base.emi);
  });

  it("clamps the EMI day to short months", () => {
    const a = amortize({ ...base, firstDate: "2026-01-31", emiDay: 31 });
    expect(a.rows.slice(0, 3).map((r) => r.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("shortens the loan with extra monthly payments or a lump sum", () => {
    const plain = amortize(base);
    const extra = amortize({ ...base, extraMonthly: rs(2_000) });
    const lump = amortize({ ...base, lump: { date: "2026-06-01", amount: rs(100_000) } });
    expect(extra.rows.length).toBeLessThan(plain.rows.length);
    expect(extra.totalInterest).toBeLessThan(plain.totalInterest);
    expect(lump.rows.length).toBeLessThan(plain.rows.length);
    expect(extra.rows.at(-1)!.balance).toBe(0);
  });

  it("flags an EMI that never pays the loan off", () => {
    const a = amortize({ balance: rs(1_000_000), annualPct: 12, emi: rs(5_000), firstDate: "2026-02-05" });
    expect(a.paysOff).toBe(false);
    expect(a.rows).toHaveLength(0);
  });
});

describe("loan status", () => {
  const loan: Liability = { id: "l1", name: "Bike", emi: emiFor(rs(100_000), 12, 24), emiDay: 5, endDate: "2028-01-05", principal: rs(100_000), ratePct: 12, startDate: "2026-01-15", tenureMonths: 24 };

  it("places the first EMI a month after disbursal", () => {
    expect(firstEmiDate("2026-01-15", 5)).toBe("2026-02-05");
    expect(firstEmiDate("2026-01-31", 31)).toBe("2026-02-28");
  });

  it("works out outstanding balance, progress and payoff from the schedule", () => {
    const s = loanStatus(loan, "2026-10-19");
    expect(s.mode).toBe("amortized");
    expect(s.paidCount).toBe(9); // Feb–Oct
    expect(s.remainingCount).toBe(15);
    expect(s.totalCount).toBe(24);
    expect(s.nextDate).toBe("2026-11-05");
    expect(s.payoffDate).toBe("2028-01-05");
    expect(s.outstanding).toBe(s.rows[8]!.balance);
    expect(s.principalPaid! + s.outstanding!).toBe(loan.principal);
    expect(s.interestPaid! + s.interestRemaining!).toBe(s.rows.reduce((a, r) => a + r.interest, 0));
    expect(s.progress).toBeGreaterThan(0.3);
    expect(s.progress).toBeLessThan(0.5);
  });

  it("reports zero outstanding once the last EMI has passed", () => {
    const s = loanStatus(loan, "2028-02-01");
    expect(s).toMatchObject({ outstanding: 0, remainingCount: 0, nextDate: null });
  });

  it("falls back to counting EMIs for a loan with only an EMI and end date", () => {
    const s = loanStatus({ id: "l2", name: "Old", emi: rs(3_500), emiDay: 5, endDate: "2027-03-05" }, "2026-10-19");
    expect(s).toMatchObject({ mode: "basic", outstanding: null, remainingCount: 5, remainingPayable: rs(17_500), nextDate: "2026-11-05", payoffDate: "2027-03-05" });
  });

  it("quantifies a prepayment from today's balance", () => {
    const s = loanStatus(loan, "2026-10-19");
    const r = prepaymentImpact(s, "2026-10-19", { extraMonthly: rs(1_000) })!;
    expect(r.monthsSaved).toBeGreaterThan(0);
    expect(r.interestSaved).toBeGreaterThan(0);
    expect(r.baseInterest - r.newInterest).toBe(r.interestSaved);
    expect(r.baseMonths).toBe(15);
    expect(prepaymentImpact(loanStatus({ ...loan, principal: undefined }, "2026-10-19"), "2026-10-19", { lump: 1 })).toBeNull();
  });
});

describe("debt summary", () => {
  it("totals the burden, finds the debt-free date and orders by interest rate", () => {
    const a: Liability = { id: "a", name: "Car", emi: emiFor(rs(500_000), 9, 60), emiDay: 5, endDate: "2031-01-05", principal: rs(500_000), ratePct: 9, startDate: "2026-01-01", tenureMonths: 60 };
    const b: Liability = { id: "b", name: "Personal", emi: emiFor(rs(200_000), 16, 36), emiDay: 10, endDate: "2028-12-10", principal: rs(200_000), ratePct: 16, startDate: "2026-01-01", tenureMonths: 36 };
    const old: Liability = { id: "c", name: "Legacy", emi: rs(2_000), emiDay: 1, endDate: "2027-01-01" };
    const asOf = "2026-10-19";
    const d = debtSummary([a, b, old].map((l) => loanStatus(l, asOf)), rs(100_000));
    expect(d.monthlyEmi).toBe(a.emi + b.emi + old.emi);
    expect(d.emiToIncome).toBeCloseTo(d.monthlyEmi / rs(100_000), 9);
    expect(d.unknownBalanceCount).toBe(1);
    expect(d.avalanche.map((s) => s.loan.id)).toEqual(["b", "a"]); // 16% before 9%
    expect(d.debtFreeDate).toBe("2031-01-05"); // the car loan: 60 EMIs from Feb 2026
    expect(d.outstanding).toBeGreaterThan(0);
    expect(debtSummary([], null)).toMatchObject({ outstanding: 0, debtFreeDate: null, emiToIncome: null });
  });
});

describe("monthly schedules", () => {
  const asOf = "2026-10-19";
  const inst = (id: string, name: string, details: Instrument["details"], extra: Partial<Instrument> = {}): Instrument => ({
    id, name, kind: details.kind, assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x", details, ...extra,
  });
  const sip = inst("f1", "Index fund", { kind: "mf", amfiCode: "1", sip: { amount: rs(5_000), day: 31, start: "2026-01-31", end: "2026-12-31" } });
  const openSip = inst("f2", "Flexi fund", { kind: "mf", amfiCode: "2", sip: { amount: rs(10_000), day: 5, start: "2025-06-05" } });
  const rd = inst("r1", "SBI RD", { kind: "rd", bank: "SBI", monthlyAmount: rs(5_000), ratePct: 6.8, start: "2026-01-07", tenureMonths: 12, penaltyPct: 1 });
  const chit = inst("c1", "Jewellery savings plan", { kind: "commitment", beneficiary: "Amma", monthlyAmount: rs(3_000), day: 12, start: "2026-06-12", end: "2027-04-12" }, { assetClass: "gold", taxClass: "none" });
  const loan: Liability = { id: "l1", name: "Laptop", emi: rs(10_000), emiDay: 5, endDate: "2027-02-05", principal: rs(60_000), ratePct: 0, startDate: "2026-08-15", tenureMonths: 6 };
  const txns = [txn("sip", "2026-01-31", { instrumentId: "f1", amount: rs(5_000) }), txn("sip", "2026-02-28", { instrumentId: "f1", amount: rs(5_000) })];
  const items = buildSchedules({ instruments: [sip, openSip, rd, chit], txns, liabilities: [loan], asOf });
  const by = (id: string) => items.find((i) => i.id === id)!;

  it("counts instalments, what's left and when it ends for a fixed-duration SIP", () => {
    const s = by("sip:f1");
    expect(s).toMatchObject({ kind: "sip", totalCount: 12, dueCount: 9, remainingCount: 3, remainingAmount: rs(15_000), state: "ending-soon", nextDate: "2026-10-31", end: "2026-12-31" });
    expect(s.unrecorded).toBe(7); // 9 due, only 2 recorded
    expect(s.progress).toBeCloseTo(9 / 12, 9);
  });

  it("treats a SIP with no end date as open-ended", () => {
    expect(by("sip:f2")).toMatchObject({ totalCount: null, remainingCount: null, remainingAmount: null, state: "open-ended", end: null, nextDate: "2026-11-05", progress: null });
  });

  it("derives an RD's schedule from its tenure", () => {
    expect(by("rd:r1")).toMatchObject({ kind: "rd", totalCount: 12, dueCount: 10, remainingCount: 2, end: "2026-12-07", state: "ending-soon" });
  });

  it("recognises a gold chit and a 0% EMI", () => {
    expect(by("cm:c1")).toMatchObject({ kind: "chit", subtitle: "For Amma", totalCount: 11, dueCount: 5, remainingCount: 6 });
    expect(by("emi:l1")).toMatchObject({ kind: "emi", isSaving: false, totalCount: 6, dueCount: 2, remainingCount: 4, remainingAmount: rs(40_000), nextDate: "2026-11-05" });
  });

  it("totals the monthly load and splits saving from debt", () => {
    expect(scheduleTotals(items)).toMatchObject({ monthlyTotal: rs(5_000 + 10_000 + 5_000 + 3_000 + 10_000), savingPerMonth: rs(23_000), debtPerMonth: rs(10_000), activeCount: 5 });
  });

  it("shows the load shrinking as schedules end", () => {
    const ladder = monthlyLadder(items, "2026-10", 8);
    const total = (m: string) => ladder.find((l) => l.month === m)!.total;
    expect(total("2026-10")).toBe(rs(33_000));
    expect(total("2026-12")).toBe(rs(33_000)); // SIP (Dec 31) and RD (Dec 7) still run
    expect(total("2027-01")).toBe(rs(10_000 + 3_000 + 10_000)); // fixed SIP and RD finished; open SIP, chit and EMI remain
    expect(ladder.find((l) => l.month === "2027-03")!.byKind.emi).toBe(0); // loan ended Feb 2027
    expect(ladder[0]!.byKind).toMatchObject({ sip: rs(15_000), rd: rs(5_000), chit: rs(3_000), emi: rs(10_000) });
  });

  it("lists what frees up, soonest first", () => {
    const e = endingEvents(items, asOf);
    expect(e.map((x) => x.item.id)).toEqual(["rd:r1", "sip:f1", "emi:l1", "cm:c1"]);
    expect(e[0]).toMatchObject({ date: "2026-12-07", freed: rs(5_000) });
  });

  it("marks finished schedules done and keeps them out of the totals", () => {
    const done = buildSchedules({ instruments: [], txns: [], liabilities: [{ ...loan, endDate: "2026-09-05" }], asOf });
    expect(done[0]!.state).toBe("done");
    expect(scheduleTotals(done).monthlyTotal).toBe(0);
  });
});

describe("plan duration", () => {
  it("finds the final instalment date of an N-month plan", async () => {
    const { lastInstalmentDate } = await import("./obligations");
    expect(lastInstalmentDate("2026-01-31", 31, 12)).toBe("2026-12-31");
    expect(lastInstalmentDate("2026-01-15", 5, 12)).toBe("2027-01-05"); // the 5th had passed, so instalment 1 is 5 Feb
    expect(lastInstalmentDate("2026-01-01", 5, 12)).toBe("2026-12-05");
    expect(lastInstalmentDate("2026-01-31", 31, 2)).toBe("2026-02-28"); // short month clamp
    expect(lastInstalmentDate("2026-06-12", 12, 11)).toBe("2027-04-12");
  });
});
