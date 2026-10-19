import { describe, expect, it } from "vitest";
import { planAutoPosts, sipsDue, unitsFor } from "./autopost";
import { txn } from "./test-helpers";
import type { Instrument, PricePoint } from "./types";

const base = { assetClass: "debt", taxClass: "slab", emergencyLayer: "second", createdAt: "x" } as const;
const rd = (over: Record<string, unknown> = {}): Instrument => ({ id: "rd", name: "SBI RD", kind: "rd", ...base, details: { kind: "rd", bank: "SBI", monthlyAmount: 5_000_00, ratePct: 7, start: "2026-01-10", tenureMonths: 6, penaltyPct: 1, accountId: "a", autoFrom: "2026-01-01", ...over } }) as Instrument;
const bond = (over: Record<string, unknown> = {}): Instrument =>
  ({ id: "b", name: "Muthoot NCD", kind: "bond", ...base, details: { kind: "bond", issuer: "Muthoot", faceValue: 1000, couponPct: 9, payout: "quarterly", maturity: "2027-03-15", tdsPct: 10, listed: true, payoutAccountId: "a", autoFrom: "2026-01-01", ...over } }) as Instrument;
const sipFund = (over: Record<string, unknown> = {}): Instrument => ({ id: "f", name: "Flexi Cap", kind: "mf", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x", details: { kind: "mf", amfiCode: "1", sip: { amount: 5_000_00, day: 5, start: "2026-01-05", ...over } } }) as Instrument;

describe("RD on schedule", () => {
  it("records each instalment that has come due, once, and the maturity when the RD ends", () => {
    const early = planAutoPosts({ instruments: [rd()], txns: [], asOf: "2026-03-20" });
    expect(early.map((p) => p.txn.date)).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
    expect(early.every((p) => p.txn.type === "rd_instalment" && p.txn.amount === 5_000_00 && p.accountId === "a" && p.txn.source === "auto")).toBe(true);

    const done = planAutoPosts({ instruments: [rd()], txns: [], asOf: "2026-08-01" });
    expect(done.filter((p) => p.txn.type === "rd_instalment")).toHaveLength(6);
    const maturity = done.find((p) => p.txn.type === "maturity")!;
    expect(maturity.txn.date).toBe("2026-07-10");
    expect(maturity.txn.amount).toBeGreaterThan(30_000_00);
  });

  it("skips months already recorded by hand and keys already handled, and never starts before autoFrom", () => {
    const handled = rd({ autoLog: ["rd:2026-01-10"] });
    const manual = [txn("rd_instalment", "2026-02-12", { instrumentId: "rd", amount: 5_000_00 })];
    const plan = planAutoPosts({ instruments: [handled], txns: manual, asOf: "2026-03-20" });
    expect(plan.map((p) => p.txn.date)).toEqual(["2026-03-10"]);
    expect(planAutoPosts({ instruments: [rd({ autoFrom: "2026-03-01" })], txns: [], asOf: "2026-03-20" }).map((p) => p.txn.date)).toEqual(["2026-03-10"]);
    expect(planAutoPosts({ instruments: [rd({ accountId: undefined })], txns: [], asOf: "2026-03-20" })).toEqual([]);
  });

  it("uses stable ids so a repeat run overwrites rather than duplicates", () => {
    const a = planAutoPosts({ instruments: [rd()], txns: [], asOf: "2026-03-20" });
    const b = planAutoPosts({ instruments: [rd()], txns: [], asOf: "2026-03-25" });
    expect(a.map((p) => p.txn.id)).toEqual(b.map((p) => p.txn.id));
  });
});

describe("bond coupons and maturity", () => {
  const holding = [txn("buy", "2026-01-20", { instrumentId: "b", qty: 10, price: 1000 })];

  it("pays each coupon after the purchase, net of TDS to the bank, and not before the purchase", () => {
    const plan = planAutoPosts({ instruments: [bond()], txns: holding, asOf: "2026-10-01" });
    // quarterly from maturity 15 Mar: 15 Mar, 15 Jun, 15 Sep 2026 (15 Dec 2025 is before the purchase)
    expect(plan.map((p) => p.txn.date)).toEqual(["2026-03-15", "2026-06-15", "2026-09-15"]);
    const c = plan[0]!.txn;
    expect(c.type).toBe("coupon");
    expect(c.amount).toBe(Math.round((10 * 1000 * 100 * 9) / 100 / 4));
    expect(c.tds).toBe(Math.round(c.amount * 0.1));
  });

  it("redeems at face value on maturity and leaves coupons already entered by hand alone", () => {
    const manual = [...holding, txn("coupon", "2026-03-17", { instrumentId: "b", amount: 22_500 })];
    const plan = planAutoPosts({ instruments: [bond()], txns: manual, asOf: "2027-04-01" });
    expect(plan.find((p) => p.txn.date === "2026-03-15")).toBeUndefined();
    const redeem = plan.find((p) => p.txn.type === "redemption")!;
    expect(redeem.txn.qty).toBe(10);
    expect(redeem.txn.amount).toBe(10_000_00);
    expect(redeem.txn.date).toBe("2027-03-15");
    // The final coupon falls on the maturity date too.
    expect(plan.some((p) => p.txn.type === "coupon" && p.txn.date === "2027-03-15")).toBe(true);
  });

  it("does nothing without a payout account, a purchase, or after redemption was recorded", () => {
    expect(planAutoPosts({ instruments: [bond({ payoutAccountId: undefined })], txns: holding, asOf: "2027-04-01" })).toEqual([]);
    expect(planAutoPosts({ instruments: [bond()], txns: [], asOf: "2027-04-01" })).toEqual([]);
    const redeemed = [...holding, txn("redemption", "2027-03-15", { instrumentId: "b", qty: 10, price: 1000 })];
    expect(planAutoPosts({ instruments: [bond()], txns: redeemed, asOf: "2027-04-01" }).some((p) => p.txn.type === "redemption")).toBe(false);
  });
});

describe("SIP prompts", () => {
  const prices: PricePoint[] = [{ instrumentId: "f", date: "2026-10-01", price: 123.45, source: "amfi", fetchedAt: "x" }];

  it("asks about a due SIP with no instalment, offering the latest NAV", () => {
    const due = sipsDue({ instruments: [sipFund({ accountId: "a" })], txns: [], prices, asOf: "2026-10-07" });
    // Looks back two months only: 5 Aug is too old to ask about.
    expect(due.map((d) => d.date)).toEqual(["2026-09-05", "2026-10-05"]);
    expect(due.at(-1)).toMatchObject({ month: "2026-10", amount: 5_000_00, accountId: "a", lastNav: 123.45 });
  });

  it("stops asking once the month has an instalment or was skipped, and not before the due day", () => {
    const paid = [txn("sip", "2026-10-06", { instrumentId: "f", qty: 40, price: 125 })];
    const due = sipsDue({ instruments: [sipFund({ skipped: ["2026-09"] })], txns: paid, prices, asOf: "2026-10-07" });
    expect(due).toEqual([]);
    expect(sipsDue({ instruments: [sipFund()], txns: [], prices, asOf: "2026-10-04" }).some((d) => d.month === "2026-10")).toBe(false);
  });

  it("works out units from amount and NAV", () => {
    expect(unitsFor(5_000_00, 125)).toBe(40);
    expect(unitsFor(5_000_00, 0)).toBe(0);
    expect(unitsFor(1_000_00, 33.3333)).toBeCloseTo(30.0, 3);
  });
});
