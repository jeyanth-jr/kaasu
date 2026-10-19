import { describe, expect, it } from "vitest";
import { crossedMilestones, goalProgress, monthsBetween, requiredMonthly, termFor, type Goal, type GoalFund } from "./goals";

const goal = (over: Partial<Goal> = {}): Goal => ({ id: "g", name: "Trip", icon: "plane", term: "short", target: 1_200_000, targetDate: "2027-01-15", startDate: "2026-01-15", createdAt: "", ...over });
const fund = (date: string, amount: number, id = date + amount): GoalFund => ({ id, goalId: "g", date, amount, createdAt: "" });

describe("goal horizon", () => {
  it("counts whole months, rounding a part month up", () => {
    expect(monthsBetween("2026-01-15", "2027-01-15")).toBe(12);
    expect(monthsBetween("2026-01-15", "2027-01-20")).toBe(13);
    expect(monthsBetween("2026-01-20", "2026-02-10")).toBe(1);
  });

  it("calls up to three years short term and anything further, or undated, long term", () => {
    expect(termFor("2029-01-15", "2026-01-15")).toBe("short");
    expect(termFor("2029-02-15", "2026-01-15")).toBe("long");
    expect(termFor(undefined, "2026-01-15")).toBe("long");
  });
});

describe("monthly amount needed", () => {
  it("is an even split with no growth", () => {
    expect(requiredMonthly({ target: 1_200_000, saved: 0, months: 12, ratePct: 0 })).toBe(100_000);
    expect(requiredMonthly({ target: 1_200_000, saved: 600_000, months: 6, ratePct: 0 })).toBe(100_000);
  });

  it("asks for less when savings earn a return, and nothing once savings alone will grow past the target", () => {
    const flat = requiredMonthly({ target: 1_200_000, saved: 0, months: 12, ratePct: 0 });
    const grown = requiredMonthly({ target: 1_200_000, saved: 0, months: 12, ratePct: 8 });
    expect(grown).toBeLessThan(flat);
    expect(requiredMonthly({ target: 1_000_000, saved: 990_000, months: 24, ratePct: 8 })).toBe(0);
  });
});

describe("goal progress", () => {
  const today = "2026-07-15";

  it("adds what was set aside to linked holdings and subtracts withdrawals", () => {
    const p = goalProgress({ goal: goal(), funds: [fund("2026-02-01", 300_000), fund("2026-03-01", -50_000)], linkedValue: 100_000, today });
    expect(p.contributed).toBe(250_000);
    expect(p.saved).toBe(350_000);
    expect(p.remaining).toBe(850_000);
    expect(p.fraction).toBeCloseTo(350_000 / 1_200_000);
    expect(p.monthsLeft).toBe(6);
    expect(p.requiredMonthly).toBe(Math.ceil(850_000 / 6));
  });

  it("compares with a steady plan from the start date", () => {
    // Half way through the year, a steady plan would hold 6 lakh.
    expect(goalProgress({ goal: goal(), funds: [fund("2026-03-01", 700_000)], linkedValue: 0, today }).status).toBe("ahead");
    expect(goalProgress({ goal: goal(), funds: [fund("2026-03-01", 600_000)], linkedValue: 0, today }).status).toBe("on-track");
    expect(goalProgress({ goal: goal(), funds: [fund("2026-03-01", 300_000)], linkedValue: 0, today }).status).toBe("behind");
    expect(goalProgress({ goal: goal(), funds: [fund("2026-03-01", 1_200_000)], linkedValue: 0, today }).status).toBe("done");
    expect(goalProgress({ goal: goal(), funds: [], linkedValue: 0, today: "2027-02-01" }).status).toBe("overdue");
    expect(goalProgress({ goal: goal({ targetDate: undefined }), funds: [], linkedValue: 0, today }).status).toBe("no-date");
  });

  it("projects a finish date from the last three months of saving", () => {
    const p = goalProgress({ goal: goal(), funds: [fund("2026-05-20", 90_000), fund("2026-06-20", 90_000), fund("2026-07-01", 90_000), fund("2025-12-01", 500_000)], linkedValue: 0, today });
    expect(p.recentMonthly).toBe(90_000);
    expect(p.remaining).toBe(1_200_000 - 770_000);
    expect(p.projectedDate).toBe("2026-12-15");
    expect(goalProgress({ goal: goal(), funds: [], linkedValue: 0, today }).projectedDate).toBeNull();
  });

  it("never reports negative savings", () => {
    expect(goalProgress({ goal: goal(), funds: [fund("2026-02-01", -1000)], linkedValue: 0, today }).saved).toBe(0);
  });
});

describe("milestones", () => {
  it("lists each quarter mark a contribution crosses", () => {
    expect(crossedMilestones(0.1, 0.3)).toEqual([25]);
    expect(crossedMilestones(0.2, 0.8)).toEqual([25, 50, 75]);
    expect(crossedMilestones(0.5, 0.5)).toEqual([]);
    expect(crossedMilestones(0.9, 1.2)).toEqual([100]);
  });
});
