import { addMonths, monthEnd, monthKey, monthStart, withDay, yearFrac } from "./dates";
import type { Holding } from "./portfolio";
import type {
  Instrument,
  ISODate,
  Liability,
  MonthlyPlan,
  Paise,
  PayoutFrequency,
  PlanCategory,
  PlanLine,
  Settings,
  Transaction,
} from "./types";

// ---------------------------------------------------------------------------
// Emergency fund

export interface EmergencyView {
  target: Paise;
  instant: Paise;
  second: Paise;
  instantMonths: number;
  totalMonths: number;
  instantItems: { name: string; value: Paise }[];
  secondItems: { name: string; value: Paise; note?: string }[];
}

export function emergencyView(holdings: Holding[], settings: Settings): EmergencyView {
  const target = settings.monthlyExpenses * settings.emergencyMonths;
  const live = holdings.filter((h) => !h.closed && h.value > 0);
  const instantItems = live
    .filter((h) => h.instrument.emergencyLayer === "instant")
    .map((h) => ({ name: h.instrument.name, value: h.value }));
  const secondItems = live
    .filter((h) => h.instrument.emergencyLayer === "second")
    .map((h) => ({
      name: h.instrument.name,
      // Count what you'd actually get by breaking it today.
      value: h.prematureValue ?? h.value,
      note: h.prematureValue !== null ? "after premature-withdrawal penalty" : undefined,
    }));
  const instant = instantItems.reduce((s, x) => s + x.value, 0);
  const second = secondItems.reduce((s, x) => s + x.value, 0);
  const m = settings.monthlyExpenses || 1;
  return {
    target,
    instant,
    second,
    instantMonths: instant / m,
    totalMonths: (instant + second) / m,
    instantItems,
    secondItems,
  };
}

// ---------------------------------------------------------------------------
// Cash-flow calendar

export type EventKind = "sip" | "rd" | "rd-maturity" | "fd-maturity" | "interest" | "coupon" | "bond-maturity" | "commitment" | "emi" | "emi-end";

export interface CalEvent {
  date: ISODate;
  kind: EventKind;
  title: string;
  amount: Paise | null;
  direction: "in" | "out" | "none";
  instrumentId?: string;
  estimated?: boolean;
}

const FREQ_MONTHS: Record<PayoutFrequency, number> = { monthly: 1, quarterly: 3, halfYearly: 6, yearly: 12, cumulative: 0 };

/** Monthly dates on `day` (clamped to month length) within [start, end] ∩ [from, to]. */
export function monthly(day: number, start: ISODate, end: ISODate | undefined, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const stop = end && end < to ? end : to;
  const first = monthStart(monthKey(start));
  for (let i = 0; i < 1200; i++) {
    const d = withDay(addMonths(first, i), day);
    if (d > stop) break;
    if (d >= start && d >= from) out.push(d);
  }
  return out;
}

export function calendarEvents(input: {
  instruments: Instrument[];
  holdings: Holding[];
  liabilities: Liability[];
  from: ISODate;
  to: ISODate;
}): CalEvent[] {
  const { from, to } = input;
  const out: CalEvent[] = [];
  const holdingOf = new Map(input.holdings.map((h) => [h.instrument.id, h]));
  for (const inst of input.instruments) {
    if (inst.archived) continue;
    const h = holdingOf.get(inst.id);
    if (h?.closed) continue;
    const d = inst.details;
    switch (d.kind) {
      case "mf":
        if (d.sip) {
          for (const date of monthly(d.sip.day, d.sip.start, d.sip.end, from, to)) {
            out.push({ date, kind: "sip", title: `SIP · ${inst.name}`, amount: d.sip.amount, direction: "out", instrumentId: inst.id });
          }
        }
        break;
      case "rd": {
        const maturity = addMonths(d.start, d.tenureMonths);
        const day = Number(d.start.slice(8, 10));
        for (const date of monthly(day, d.start, addMonths(maturity, -1), from, to)) {
          out.push({ date, kind: "rd", title: `RD instalment · ${d.bank}`, amount: d.monthlyAmount, direction: "out", instrumentId: inst.id });
        }
        if (maturity >= from && maturity <= to) {
          out.push({ date: maturity, kind: "rd-maturity", title: `RD matures · ${d.bank}`, amount: estimateRdMaturity(d.monthlyAmount, d.ratePct, d.tenureMonths), direction: "in", instrumentId: inst.id, estimated: true });
        }
        break;
      }
      case "fd": {
        if (d.maturity >= from && d.maturity <= to) {
          out.push({ date: d.maturity, kind: "fd-maturity", title: `FD matures · ${d.bank}`, amount: h ? estimateAtMaturity(h, d.ratePct, d.maturity, d.payout, from) : null, direction: "in", instrumentId: inst.id, estimated: true });
        }
        const step = FREQ_MONTHS[d.payout];
        if (step > 0 && h) {
          const per = Math.round((h.invested * d.ratePct) / 100 / (12 / step));
          for (let i = 1; ; i++) {
            const date = addMonths(d.start, i * step);
            if (date > to || date > d.maturity) break;
            if (date >= from) out.push({ date, kind: "interest", title: `FD interest · ${d.bank}`, amount: per, direction: "in", instrumentId: inst.id, estimated: true });
          }
        }
        break;
      }
      case "bond": {
        if (d.maturity >= from && d.maturity <= to) {
          out.push({ date: d.maturity, kind: "bond-maturity", title: `Bond matures · ${d.issuer}`, amount: h ? Math.round(h.qty * d.faceValue * 100) : null, direction: "in", instrumentId: inst.id });
        }
        const step = FREQ_MONTHS[d.payout];
        if (step > 0 && h && h.qty > 0) {
          const per = Math.round((h.qty * d.faceValue * 100 * d.couponPct) / 100 / (12 / step));
          for (let i = 0; i < 600; i++) {
            const date = addMonths(d.maturity, -i * step);
            if (date < from) break;
            if (date <= to) out.push({ date, kind: "coupon", title: `Coupon · ${d.issuer}`, amount: Math.round(per * (1 - d.tdsPct / 100)), direction: "in", instrumentId: inst.id, estimated: d.tdsPct > 0 });
          }
        }
        break;
      }
      case "commitment":
        for (const date of monthly(d.day, d.start, d.end, from, to)) {
          out.push({ date, kind: "commitment", title: `${inst.name} · ${d.beneficiary}`, amount: d.monthlyAmount, direction: "out", instrumentId: inst.id });
        }
        break;
      default:
        break;
    }
  }
  for (const l of input.liabilities) {
    for (const date of monthly(l.emiDay, from < l.endDate ? from : l.endDate, l.endDate, from, to)) {
      out.push({ date, kind: "emi", title: `EMI · ${l.name}`, amount: l.emi, direction: "out" });
    }
    if (l.endDate >= from && l.endDate <= to) {
      out.push({ date: l.endDate, kind: "emi-end", title: `Last EMI · ${l.name}`, amount: null, direction: "none" });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

/** Indian banks' RD maturity: each instalment compounds quarterly until maturity. */
export function estimateRdMaturity(monthly: Paise, ratePct: number, months: number): Paise {
  let total = 0;
  for (let i = 0; i < months; i++) {
    const remainingMonths = months - i;
    total += monthly * Math.pow(1 + ratePct / 400, remainingMonths / 3);
  }
  return Math.round(total);
}

function estimateAtMaturity(h: Holding, ratePct: number, maturity: ISODate, payout: PayoutFrequency, asOf: ISODate): Paise {
  if (payout !== "cumulative") return h.invested;
  // Grow today's accrued value for the remaining term.
  return Math.round(h.value * Math.pow(1 + ratePct / 400, 4 * Math.max(0, yearFrac(asOf, maturity))));
}

// ---------------------------------------------------------------------------
// Monthly plan

export function defaultPlan(instruments: Instrument[], settings: Settings, month: string): MonthlyPlan {
  const s = monthStart(month);
  const e = monthEnd(month);
  const lines: PlanLine[] = [];
  for (const inst of instruments) {
    if (inst.archived) continue;
    const d = inst.details;
    if (d.kind === "mf" && d.sip && d.sip.start <= e && (!d.sip.end || d.sip.end >= s)) {
      lines.push({ id: `sip-${inst.id}`, category: "sip", label: inst.name, instrumentId: inst.id, planned: d.sip.amount });
    } else if (d.kind === "rd") {
      const maturity = addMonths(d.start, d.tenureMonths);
      if (d.start <= e && maturity > s) lines.push({ id: `rd-${inst.id}`, category: "rd", label: `RD · ${d.bank}`, instrumentId: inst.id, planned: d.monthlyAmount });
    } else if (d.kind === "commitment" && d.start <= e && (!d.end || d.end >= s)) {
      lines.push({ id: `cm-${inst.id}`, category: "commitment", label: inst.name, instrumentId: inst.id, planned: d.monthlyAmount });
    }
  }
  const used = lines.reduce((x, l) => x + l.planned, 0);
  if (settings.monthlyBudget > used) {
    lines.push({ id: "buffer", category: "buffer", label: "Buffer / lump sums", planned: settings.monthlyBudget - used });
  }
  return { month, lines };
}

const CATEGORY_OF: Partial<Record<Transaction["type"], PlanCategory>> = {
  sip: "sip",
  rd_instalment: "rd",
  commitment_payment: "commitment",
};

export interface PlanRow extends PlanLine {
  actual: Paise;
}

export interface PlanView {
  month: string;
  rows: PlanRow[];
  unplanned: { label: string; instrumentId: string; actual: Paise }[];
  plannedTotal: Paise;
  actualTotal: Paise;
}

/** Planned vs actually invested for a month. Buffer absorbs unplanned buys/deposits. */
export function planView(plan: MonthlyPlan, txns: Transaction[], instruments: Instrument[]): PlanView {
  const inMonth = txns.filter((t) => monthKey(t.date) === plan.month);
  const rows: PlanRow[] = plan.lines.map((l) => ({ ...l, actual: 0 }));
  const unplannedMap = new Map<string, number>();
  const nameOf = new Map(instruments.map((i) => [i.id, i.name]));
  for (const t of inMonth) {
    const invests = ["buy", "sip", "deposit", "rd_instalment", "commitment_payment"].includes(t.type);
    if (!invests) continue;
    const amount = t.amount + (t.charges ?? 0);
    const cat = CATEGORY_OF[t.type];
    let row = rows.find((r) => r.instrumentId === t.instrumentId && r.category !== "buffer");
    if (!row && cat) row = rows.find((r) => r.category === cat && !r.instrumentId);
    if (row) row.actual += amount;
    else unplannedMap.set(t.instrumentId, (unplannedMap.get(t.instrumentId) ?? 0) + amount);
  }
  const unplanned = [...unplannedMap.entries()].map(([instrumentId, actual]) => ({ instrumentId, actual, label: nameOf.get(instrumentId) ?? "Unknown" }));
  const buffer = rows.find((r) => r.category === "buffer");
  if (buffer) buffer.actual += unplanned.reduce((s, u) => s + u.actual, 0);
  return {
    month: plan.month,
    rows,
    unplanned,
    plannedTotal: rows.reduce((s, r) => s + r.planned, 0),
    actualTotal: rows.reduce((s, r) => s + r.actual, 0) + (buffer ? 0 : unplanned.reduce((s, u) => s + u.actual, 0)),
  };
}
