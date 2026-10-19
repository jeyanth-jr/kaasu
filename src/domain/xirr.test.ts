import { describe, expect, it } from "vitest";
import { xirr, xirrOrNull } from "./xirr";

describe("xirr", () => {
  it("matches the Excel documentation example (37.34%)", () => {
    const r = xirr([
      { date: "2008-01-01", amount: -10000 },
      { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 },
      { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rate).toBeCloseTo(0.373362535, 6);
  });

  it("uses actual/365 day count across a leap year", () => {
    const r = xirr([
      { date: "2020-01-01", amount: -1000 },
      { date: "2021-01-01", amount: 1100 }, // 366 days
    ]);
    expect(r.ok && r.rate).toBeCloseTo(Math.pow(1.1, 365 / 366) - 1, 9);
  });

  it("is order-independent", () => {
    const a = xirr([
      { date: "2021-06-01", amount: 1210 },
      { date: "2019-06-01", amount: -1000 },
    ]);
    const b = xirr([
      { date: "2019-06-01", amount: -1000 },
      { date: "2021-06-01", amount: 1210 },
    ]);
    expect(a.ok && b.ok && Math.abs(a.rate - b.rate) < 1e-12).toBe(true);
  });

  it("handles a monthly SIP with a terminal value", () => {
    // 12 × ₹1,000 SIPs, worth ₹13,000 a year after the first.
    const flows = Array.from({ length: 12 }, (_, i) => ({
      date: `2023-${String(i + 1).padStart(2, "0")}-05`,
      amount: -1000,
    }));
    flows.push({ date: "2024-01-05", amount: 13000 });
    const r = xirr(flows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Verify NPV ≈ 0 at the solved rate.
    const npv = flows.reduce(
      (s, f) => s + f.amount / Math.pow(1 + r.rate, (Date.parse(f.date) - Date.parse("2023-01-05")) / 864e5 / 365),
      0,
    );
    expect(Math.abs(npv)).toBeLessThan(1e-6);
    expect(r.rate).toBeGreaterThan(0.14);
    expect(r.rate).toBeLessThan(0.16);
  });

  it("finds deeply negative returns", () => {
    const r = xirr([
      { date: "2022-01-01", amount: -1000 },
      { date: "2023-01-01", amount: 10 },
    ]);
    expect(r.ok && r.rate).toBeCloseTo(-0.99, 6);
  });

  it("finds very large returns via bisection fallback", () => {
    const r = xirr([
      { date: "2022-01-01", amount: -100 },
      { date: "2023-01-01", amount: 1_000_000 },
    ]);
    // Relative precision is what matters at this magnitude.
    expect(r.ok && Math.abs(r.rate / 9999 - 1)).toBeLessThan(1e-6);
  });

  it("rejects flows without a sign change or with too few flows", () => {
    expect(xirr([{ date: "2022-01-01", amount: -1 }])).toEqual({ ok: false, reason: "too-few-flows" });
    expect(
      xirr([
        { date: "2022-01-01", amount: -1 },
        { date: "2023-01-01", amount: -1 },
      ]),
    ).toEqual({ ok: false, reason: "no-sign-change" });
  });

  it("refuses to annualise very short spans in xirrOrNull", () => {
    expect(
      xirrOrNull([
        { date: "2024-01-01", amount: -1000 },
        { date: "2024-01-10", amount: 1010 },
      ]),
    ).toBeNull();
  });

  it("ignores zero flows", () => {
    const r = xirr([
      { date: "2020-01-01", amount: -1000 },
      { date: "2020-06-01", amount: 0 },
      { date: "2021-01-01", amount: 1000 },
    ]);
    expect(r.ok && Math.abs(r.rate)).toBeLessThan(1e-9);
  });
});
