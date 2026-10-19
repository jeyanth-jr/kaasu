import { describe, expect, it } from "vitest";
import { GOAL_STEPS, describeKey, detectWins, goalStreak, nextGoalStep, pickToShow, resolveGoal, savedInMonth, type SavingsSnapshot } from "./savings";
import { txn } from "./test-helpers";
import type { Instrument } from "./types";

const inst = (id: string, kind: Instrument["kind"], extra: Partial<Instrument> = {}): Instrument => ({
  id, name: id, kind, assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x",
  details: kind === "cash" ? { kind: "cash", bank: "x", account: "savings" } : { kind: "stock", exchange: "NSE", symbol: id },
  ...extra,
});
const byId = new Map([inst("stock", "stock"), inst("cash", "cash"), inst("demo", "stock", { sample: true })].map((i) => [i.id, i]));
const rs = (n: number) => n * 100;

const snap = (over: Partial<SavingsSnapshot> = {}): SavingsSnapshot => ({ month: "2026-10", saved: 0, goal: rs(10_000), netWorth: rs(50_000), emergencyMonths: 0, investedCount: 3, streak: 0, ...over });

describe("what counts as saved", () => {
  it("counts buys, SIPs, deposits and instalments (with charges) but not cash moves, sells or sample data", () => {
    const txns = [
      txn("sip", "2026-10-05", { instrumentId: "stock", amount: rs(5_000) }),
      txn("buy", "2026-10-06", { instrumentId: "stock", amount: rs(2_000), charges: rs(20) }),
      txn("deposit", "2026-10-07", { instrumentId: "cash", amount: rs(50_000) }), // moving money, not saving
      txn("sell", "2026-10-08", { instrumentId: "stock", amount: rs(9_000) }),
      txn("buy", "2026-10-09", { instrumentId: "demo", amount: rs(99_999), source: "sample" }),
      txn("sip", "2026-09-05", { instrumentId: "stock", amount: rs(1_000) }), // other month
    ];
    expect(savedInMonth(txns, byId, "2026-10")).toBe(rs(7_020));
  });

  it("counts consecutive goal-hitting months", () => {
    const hit = (m: string, amount: number) => txn("sip", `${m}-05`, { instrumentId: "stock", amount: rs(amount) });
    const txns = [hit("2026-10", 10_000), hit("2026-09", 12_000), hit("2026-08", 4_000), hit("2026-07", 10_000)];
    expect(goalStreak(txns, byId, "2026-10", rs(10_000))).toBe(2); // Aug broke it
    expect(goalStreak(txns, byId, "2026-08", rs(10_000))).toBe(0);
  });
});

describe("the monthly goal", () => {
  it("prefers what you set, then your plans, then 20% of salary", () => {
    expect(resolveGoal({ goal: rs(8_000), planned: rs(26_000), salary: rs(140_000) })).toEqual({ amount: rs(8_000), source: "set" });
    expect(resolveGoal({ planned: rs(26_000), salary: rs(140_000) })).toEqual({ amount: rs(26_000), source: "plans" });
    expect(resolveGoal({ planned: 0, salary: rs(83_333) })).toEqual({ amount: rs(16_500), source: "salary" });
    expect(resolveGoal({ planned: 0 })).toEqual({ amount: rs(10_000), source: "default" });
  });

  it("points at the next milestone", () => {
    expect(nextGoalStep(rs(3_000), rs(10_000))).toEqual({ pct: 50, amount: rs(5_000) });
    expect(nextGoalStep(rs(20_000), rs(10_000))).toBeNull();
    expect(nextGoalStep(0, 0)).toBeNull();
  });
});

describe("detecting wins", () => {
  const none = new Set<string>();

  it("celebrates nothing on the first look (so opening the app or syncing never replays history)", () => {
    expect(detectWins(null, snap({ saved: rs(50_000) }), none)).toEqual([]);
  });

  it("celebrates each goal milestone as it is crossed, once", () => {
    const w = detectWins(snap({ saved: rs(2_000) }), snap({ saved: rs(5_000) }), none);
    // 20% → 50% crosses both the 25% and the 50% steps.
    expect(w.map((x) => x.key)).toEqual(["goal:2026-10:25", "goal:2026-10:50"]);
    expect(pickToShow(w, 1)[0]).toMatchObject({ kind: "goal", title: "Halfway there", tier: "small" });
    expect(detectWins(snap({ saved: rs(3_000) }), snap({ saved: rs(5_000) }), none).map((x) => x.key)).toEqual(["goal:2026-10:50"]);
    // Already celebrated: silent.
    expect(detectWins(snap({ saved: rs(2_000) }), snap({ saved: rs(5_000) }), new Set(["goal:2026-10:25", "goal:2026-10:50"]))).toEqual([]);
    // No movement across a step: silent.
    expect(detectWins(snap({ saved: rs(5_000) }), snap({ saved: rs(6_000) }), none)).toEqual([]);
  });

  it("reports every step crossed in one big save, and picks the best to show", () => {
    const w = detectWins(snap({ saved: 0 }), snap({ saved: rs(10_000) }), none);
    expect(w.map((x) => x.key).sort()).toEqual(GOAL_STEPS.filter((s) => s <= 100).map((s) => `goal:2026-10:${s}`).sort());
    const shown = pickToShow(w, 2);
    expect(shown).toHaveLength(2);
    expect(shown[0]!.title).toBe("Goal smashed");
    expect(shown[0]!.tier).toBe("big");
  });

  it("doesn't count a changed goal as a win", () => {
    expect(detectWins(snap({ saved: rs(4_000), goal: rs(10_000) }), snap({ saved: rs(4_000), goal: rs(2_000) }), none)).toEqual([]);
  });

  it("celebrates a streak when the goal is hit again", () => {
    const w = detectWins(snap({ saved: rs(9_000), streak: 1 }), snap({ saved: rs(10_500), streak: 3 }), new Set(["goal:2026-10:25", "goal:2026-10:50", "goal:2026-10:75", "goal:2026-10:100"]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ kind: "streak", title: "3 months in a row", tier: "big" });
  });

  it("celebrates the first investment, net-worth levels and emergency runway", () => {
    expect(detectWins(snap({ investedCount: 0 }), snap({ investedCount: 1 }), none).map((x) => x.key)).toEqual(["first:invest"]);
    const nw = detectWins(snap({ netWorth: rs(9_90_000) }), snap({ netWorth: rs(10_10_000) }), none);
    expect(nw.map((x) => [x.key, x.title, x.tier])).toEqual([["nw:1000000", "₹10L net worth", "big"]]);
    const em = detectWins(snap({ emergencyMonths: 2.9 }), snap({ emergencyMonths: 3.1 }), none);
    expect(em[0]).toMatchObject({ key: "emergency:3", tier: "medium" });
    expect(detectWins(snap({ emergencyMonths: 5.9 }), snap({ emergencyMonths: 6 }), none)[0]!.title).toBe("Emergency fund complete");
  });

  it("can switch off net-worth and emergency wins (for sample data)", () => {
    expect(detectWins(snap({ netWorth: 0 }), snap({ netWorth: rs(30_00_000) }), none, { assetWins: false })).toEqual([]);
  });

  it("rebuilds a readable title from a stored key", () => {
    expect(describeKey("nw:5000000")?.title).toBe("₹50L net worth");
    expect(describeKey("goal:2026-10:100")?.title).toBe("Goal smashed");
    expect(describeKey("garbage")).toBeNull();
  });
});
