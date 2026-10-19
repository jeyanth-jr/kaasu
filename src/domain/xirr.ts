import { daysBetween } from "./dates";
import type { ISODate } from "./types";

export interface CashFlow {
  date: ISODate;
  /** Investor perspective: money out (investment) negative, money in positive. */
  amount: number;
}

export type XirrResult =
  | { ok: true; rate: number }
  | { ok: false; reason: "too-few-flows" | "no-sign-change" | "too-short" | "no-convergence" };

/**
 * Annualised internal rate of return for irregular cash flows (Excel XIRR,
 * actual/365). Newton–Raphson from a few seeds, falling back to bisection on a
 * bracketed root. Returns a decimal rate (0.12 = 12%).
 */
export function xirr(flows: CashFlow[], opts: { minDays?: number } = {}): XirrResult {
  const cfs = flows.filter((f) => f.amount !== 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (cfs.length < 2) return { ok: false, reason: "too-few-flows" };
  const hasNeg = cfs.some((f) => f.amount < 0);
  const hasPos = cfs.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return { ok: false, reason: "no-sign-change" };
  const d0 = cfs[0]!.date;
  const t = cfs.map((f) => daysBetween(d0, f.date) / 365);
  const a = cfs.map((f) => f.amount);
  const span = t[t.length - 1]!;
  // Annualising returns over a few days produces absurd numbers.
  if (span * 365 < (opts.minDays ?? 0)) return { ok: false, reason: "too-short" };
  if (span === 0) return { ok: false, reason: "too-short" };

  const npv = (r: number) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]! / Math.pow(1 + r, t[i]!);
    return s;
  };
  const dnpv = (r: number) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s -= (t[i]! * a[i]!) / Math.pow(1 + r, t[i]! + 1);
    return s;
  };

  const scale = Math.max(...a.map(Math.abs));
  const tol = 1e-9 * scale;

  for (const seed of [0.1, 0, -0.5, 1, 5]) {
    let r = seed;
    for (let i = 0; i < 100; i++) {
      const f = npv(r);
      if (Math.abs(f) < tol) return { ok: true, rate: r };
      const df = dnpv(r);
      if (!Number.isFinite(df) || df === 0) break;
      const next = r - f / df;
      if (!Number.isFinite(next) || next <= -0.999999) break;
      if (Math.abs(next - r) < 1e-12) return { ok: true, rate: next };
      r = next;
    }
  }

  // Bisection: find a bracket in (-0.9999, 1e6).
  let lo = -0.9999;
  let hi = 1;
  let flo = npv(lo);
  let fhi = npv(hi);
  while (flo * fhi > 0 && hi < 1e6) {
    hi *= 2;
    fhi = npv(hi);
  }
  if (flo * fhi > 0) return { ok: false, reason: "no-convergence" };
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < tol || hi - lo < 1e-12) return { ok: true, rate: mid };
    if (fm * flo < 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return { ok: false, reason: "no-convergence" };
}

export function xirrOrNull(flows: CashFlow[]): number | null {
  // Below ~30 days annualised figures mislead; show simple return instead.
  const r = xirr(flows, { minDays: 30 });
  return r.ok ? r.rate : null;
}
