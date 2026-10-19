import { addMonths, daysBetween, formatDate, monthEnd, monthKey, monthStart, withDay } from "./dates";
import { monthly } from "./schedule";
import type { Instrument, ISODate, Liability, LoanKind, Paise, Transaction } from "./types";

/**
 * Everything you've committed to pay every month, with how long it runs:
 * SIPs, RDs, gold chits / savings plans (money going to you) and EMIs
 * (money going to a lender). Plus the loan maths behind the debt view.
 */

// ---------------------------------------------------------------------------
// Loan maths

/** Monthly instalment for a reducing-balance loan, rounded to the paisa. */
export function emiFor(principal: Paise, annualPct: number, months: number): Paise {
  if (months <= 0) return 0;
  const r = annualPct / 1200;
  if (r === 0) return Math.round(principal / months);
  const g = Math.pow(1 + r, months);
  return Math.round((principal * r * g) / (g - 1));
}

/** How many instalments an EMI takes to clear a balance; null when the EMI doesn't even cover the interest. */
export function monthsFor(principal: Paise, annualPct: number, emi: Paise): number | null {
  if (emi <= 0 || principal <= 0) return null;
  const r = annualPct / 1200;
  if (r === 0) return Math.ceil(principal / emi);
  if (emi <= principal * r) return null;
  return Math.ceil(Math.log(emi / (emi - principal * r)) / Math.log(1 + r));
}

export interface AmortRow {
  n: number;
  date: ISODate;
  payment: Paise;
  interest: Paise;
  principal: Paise;
  /** Balance after this payment. */
  balance: Paise;
}

export interface Amortization {
  rows: AmortRow[];
  /** False when the EMI is too small to ever clear the balance. */
  paysOff: boolean;
  totalInterest: Paise;
}

/**
 * Month-by-month schedule. `extraMonthly` is added to every EMI and `lump`
 * is a one-off prepayment applied before the first instalment on/after its date.
 */
export function amortize(input: {
  balance: Paise;
  annualPct: number;
  emi: Paise;
  firstDate: ISODate;
  emiDay?: number;
  extraMonthly?: Paise;
  lump?: { date: ISODate; amount: Paise };
  maxMonths?: number;
}): Amortization {
  const r = input.annualPct / 1200;
  const day = input.emiDay ?? Number(input.firstDate.slice(8));
  const base = monthStart(monthKey(input.firstDate));
  let balance = input.balance;
  let lumpLeft = input.lump?.amount ?? 0;
  const rows: AmortRow[] = [];
  let totalInterest = 0;
  for (let i = 0; i < (input.maxMonths ?? 720) && balance > 0; i++) {
    const date = withDay(addMonths(base, i), day);
    if (lumpLeft > 0 && input.lump && date >= input.lump.date) {
      const use = Math.min(lumpLeft, balance);
      balance -= use;
      lumpLeft = 0;
      if (balance <= 0) break;
    }
    const interest = Math.round(balance * r);
    let payment = input.emi + (input.extraMonthly ?? 0);
    if (payment >= balance + interest) payment = balance + interest;
    const principal = payment - interest;
    if (principal <= 0) return { rows, paysOff: false, totalInterest };
    balance -= principal;
    totalInterest += interest;
    rows.push({ n: i + 1, date, payment, interest, principal, balance });
  }
  return { rows, paysOff: balance <= 0, totalInterest };
}

export const LOAN_KIND_LABEL: Record<LoanKind, string> = {
  home: "Home loan",
  car: "Car loan",
  bike: "Two-wheeler loan",
  personal: "Personal loan",
  education: "Education loan",
  gold: "Gold loan",
  card: "Credit card EMI",
  consumer: "Consumer / no-cost EMI",
  other: "Other loan",
};

/** First EMI is one month after disbursal, on the EMI day. */
export function firstEmiDate(startDate: ISODate, emiDay: number): ISODate {
  return withDay(addMonths(startDate, 1), emiDay);
}

export interface LoanStatus {
  loan: Liability;
  /** "amortized" needs principal, rate and start date; otherwise only the EMI calendar is known. */
  mode: "amortized" | "basic";
  outstanding: Paise | null;
  paidCount: number;
  remainingCount: number;
  totalCount: number | null;
  nextDate: ISODate | null;
  payoffDate: ISODate | null;
  /** Remaining EMIs × EMI (or exact remaining payments when amortized). */
  remainingPayable: Paise;
  interestPaid: Paise | null;
  interestRemaining: Paise | null;
  principalPaid: Paise | null;
  /** 0–1 of principal repaid (amortized) or of instalments elapsed (basic). */
  progress: number;
  rows: AmortRow[];
  neverPaysOff: boolean;
}

export function loanStatus(loan: Liability, asOf: ISODate): LoanStatus {
  const canAmortize = !!loan.principal && loan.ratePct !== undefined && !!loan.startDate;
  if (canAmortize) {
    const a = amortize({ balance: loan.principal!, annualPct: loan.ratePct!, emi: loan.emi, firstDate: firstEmiDate(loan.startDate!, loan.emiDay), emiDay: loan.emiDay });
    const paid = a.rows.filter((r) => r.date <= asOf);
    const left = a.rows.filter((r) => r.date > asOf);
    const outstanding = paid.length ? paid[paid.length - 1]!.balance : loan.principal!;
    const interestPaid = paid.reduce((s, r) => s + r.interest, 0);
    const interestRemaining = left.reduce((s, r) => s + r.interest, 0);
    return {
      loan,
      mode: "amortized",
      outstanding: a.paysOff && left.length === 0 ? 0 : outstanding,
      paidCount: paid.length,
      remainingCount: left.length,
      totalCount: a.paysOff ? a.rows.length : null,
      nextDate: left[0]?.date ?? null,
      payoffDate: a.paysOff ? (a.rows.at(-1)?.date ?? null) : null,
      remainingPayable: left.reduce((s, r) => s + r.payment, 0),
      interestPaid,
      interestRemaining,
      principalPaid: loan.principal! - outstanding,
      progress: loan.principal! > 0 ? Math.min(1, (loan.principal! - outstanding) / loan.principal!) : 0,
      rows: a.rows,
      neverPaysOff: !a.paysOff,
    };
  }
  // Basic: just EMI day-of-month and last EMI date.
  const startFrom = loan.startDate ? firstEmiDate(loan.startDate, loan.emiDay) : asOf;
  const all = monthly(loan.emiDay, startFrom, loan.endDate, startFrom, loan.endDate);
  const left = all.filter((d) => d > asOf);
  const paidCount = loan.startDate ? all.length - left.length : 0;
  const totalCount = loan.startDate ? all.length : null;
  const next = left[0] ?? null;
  return {
    loan,
    mode: "basic",
    outstanding: null,
    paidCount,
    remainingCount: left.length,
    totalCount,
    nextDate: next,
    payoffDate: loan.endDate >= asOf ? loan.endDate : null,
    remainingPayable: left.length * loan.emi,
    interestPaid: null,
    interestRemaining: null,
    principalPaid: null,
    progress: totalCount ? paidCount / totalCount : 0,
    rows: [],
    neverPaysOff: false,
  };
}

export interface PrepaymentImpact {
  baseMonths: number;
  newMonths: number;
  monthsSaved: number;
  baseInterest: Paise;
  newInterest: Paise;
  interestSaved: Paise;
  newPayoffDate: ISODate | null;
}

/** What paying extra every month and/or a lump sum today would save, from the current balance. */
export function prepaymentImpact(s: LoanStatus, asOf: ISODate, opts: { extraMonthly?: Paise; lump?: Paise }): PrepaymentImpact | null {
  if (s.mode !== "amortized" || s.outstanding === null || s.outstanding <= 0 || s.neverPaysOff) return null;
  const loan = s.loan;
  const first = s.nextDate ?? firstEmiDate(asOf, loan.emiDay);
  const common = { balance: s.outstanding, annualPct: loan.ratePct!, emi: loan.emi, firstDate: first, emiDay: loan.emiDay };
  const base = amortize(common);
  const next = amortize({ ...common, extraMonthly: opts.extraMonthly, lump: opts.lump ? { date: asOf, amount: opts.lump } : undefined });
  return {
    baseMonths: base.rows.length,
    newMonths: next.rows.length,
    monthsSaved: base.rows.length - next.rows.length,
    baseInterest: base.totalInterest,
    newInterest: next.totalInterest,
    interestSaved: base.totalInterest - next.totalInterest,
    newPayoffDate: next.rows.at(-1)?.date ?? null,
  };
}

export interface DebtSummary {
  outstanding: Paise;
  /** Loans whose balance isn't known (no principal/rate/start) aren't in `outstanding`. */
  unknownBalanceCount: number;
  monthlyEmi: Paise;
  /** EMI burden as a share of salary; null without a salary. */
  emiToIncome: number | null;
  debtFreeDate: ISODate | null;
  interestRemaining: Paise;
  /** Highest-rate first: where extra money saves the most (the "avalanche" order). */
  avalanche: LoanStatus[];
  active: LoanStatus[];
}

export function debtSummary(statuses: LoanStatus[], salary: Paise | null | undefined): DebtSummary {
  const active = statuses.filter((s) => s.remainingCount > 0);
  const outstanding = active.reduce((sum, s) => sum + (s.outstanding ?? 0), 0);
  const monthlyEmi = active.reduce((sum, s) => sum + s.loan.emi, 0);
  const payoffs = active.map((s) => s.payoffDate).filter((d): d is ISODate => !!d);
  return {
    outstanding,
    unknownBalanceCount: active.filter((s) => s.outstanding === null).length,
    monthlyEmi,
    emiToIncome: salary && salary > 0 ? monthlyEmi / salary : null,
    debtFreeDate: active.length > 0 && payoffs.length === active.length ? payoffs.reduce((a, b) => (a > b ? a : b)) : null,
    interestRemaining: active.reduce((sum, s) => sum + (s.interestRemaining ?? 0), 0),
    avalanche: active.filter((s) => s.mode === "amortized" && (s.loan.ratePct ?? 0) > 0).sort((a, b) => (b.loan.ratePct ?? 0) - (a.loan.ratePct ?? 0)),
    active,
  };
}

// ---------------------------------------------------------------------------
// Monthly schedules (SIP, RD, chit, EMI)

export type ScheduleKind = "sip" | "rd" | "chit" | "commitment" | "emi";

export const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  sip: "SIP",
  rd: "Recurring deposit",
  chit: "Gold chit / savings plan",
  commitment: "Commitment",
  emi: "EMI",
};

export type ScheduleState = "upcoming" | "active" | "ending-soon" | "open-ended" | "done";

export interface ScheduleItem {
  id: string;
  kind: ScheduleKind;
  name: string;
  subtitle?: string;
  amount: Paise;
  day: number;
  start: ISODate;
  /** Date of the last instalment; null = runs until you stop it. */
  end: ISODate | null;
  /** Instalments whose date has passed. */
  dueCount: number;
  totalCount: number | null;
  remainingCount: number | null;
  remainingAmount: Paise | null;
  nextDate: ISODate | null;
  /** Instalments due but not recorded as transactions (SIP, RD, chit only). */
  unrecorded: number | null;
  state: ScheduleState;
  /** 0–1 through the schedule; null if open-ended. */
  progress: number | null;
  instrumentId?: string;
  liabilityId?: string;
  /** Money going to you (investing) rather than to a lender. */
  isSaving: boolean;
}

const CHIT_RE = /gold|chit|jewel|ornament|scheme/i;

function build(
  base: Omit<ScheduleItem, "dueCount" | "totalCount" | "remainingCount" | "remainingAmount" | "nextDate" | "state" | "progress" | "unrecorded">,
  asOf: ISODate,
  recorded: number | null,
): ScheduleItem {
  // Open-ended schedules are only walked two months past today (enough to find the next instalment).
  const all = monthly(base.day, base.start, base.end ?? undefined, base.start, base.end ?? addMonths(asOf, 2));
  const due = all.filter((d) => d <= asOf).length;
  const total = base.end ? all.length : null;
  const remaining = total === null ? null : Math.max(0, total - due);
  const next = all.find((d) => d > asOf) ?? null;
  let state: ScheduleState = "active";
  if (base.start > asOf) state = "upcoming";
  else if (base.end && base.end < asOf) state = "done";
  else if (remaining !== null && remaining <= 3) state = "ending-soon";
  else if (!base.end) state = "open-ended";
  return {
    ...base,
    dueCount: due,
    totalCount: total,
    remainingCount: remaining,
    remainingAmount: remaining === null ? null : remaining * base.amount,
    nextDate: state === "done" ? null : next,
    unrecorded: recorded === null ? null : Math.max(0, due - recorded),
    state,
    progress: total ? Math.min(1, due / total) : null,
  };
}

const count = (txns: Transaction[], instrumentId: string, types: Transaction["type"][]) => txns.filter((t) => t.instrumentId === instrumentId && types.includes(t.type)).length;

/** All recurring obligations, from instruments (SIP/RD/chit) and loans (EMI). */
export function buildSchedules(input: { instruments: Instrument[]; txns: Transaction[]; liabilities: Liability[]; asOf: ISODate }): ScheduleItem[] {
  const { instruments, txns, liabilities, asOf } = input;
  const out: ScheduleItem[] = [];
  for (const inst of instruments) {
    if (inst.archived) continue;
    const d = inst.details;
    if (d.kind === "mf" && d.sip) {
      out.push(build({ id: `sip:${inst.id}`, kind: "sip", name: inst.name, amount: d.sip.amount, day: d.sip.day, start: d.sip.start, end: d.sip.end ?? null, instrumentId: inst.id, isSaving: true }, asOf, count(txns, inst.id, ["sip"])));
    } else if (d.kind === "rd") {
      const last = addMonths(d.start, d.tenureMonths - 1);
      out.push(
        build(
          { id: `rd:${inst.id}`, kind: "rd", name: inst.name, subtitle: `${d.bank} · ${d.ratePct}% · matures ${formatDate(addMonths(d.start, d.tenureMonths))}`, amount: d.monthlyAmount, day: Number(d.start.slice(8)), start: d.start, end: last, instrumentId: inst.id, isSaving: true },
          asOf,
          count(txns, inst.id, ["rd_instalment"]),
        ),
      );
    } else if (d.kind === "commitment") {
      const kind: ScheduleKind = CHIT_RE.test(`${inst.name} ${d.beneficiary}`) || inst.assetClass === "gold" ? "chit" : "commitment";
      out.push(build({ id: `cm:${inst.id}`, kind, name: inst.name, subtitle: d.beneficiary ? `For ${d.beneficiary}` : undefined, amount: d.monthlyAmount, day: d.day, start: d.start, end: d.end ?? null, instrumentId: inst.id, isSaving: true }, asOf, count(txns, inst.id, ["commitment_payment"])));
    }
  }
  for (const l of liabilities) {
    const first = l.startDate ? firstEmiDate(l.startDate, l.emiDay) : withDay(asOf, l.emiDay);
    const start = l.startDate ? first : monthStart(monthKey(asOf));
    out.push(build({ id: `emi:${l.id}`, kind: "emi", name: l.name, subtitle: l.kind ? LOAN_KIND_LABEL[l.kind] : undefined, amount: l.emi, day: l.emiDay, start, end: l.endDate, liabilityId: l.id, isSaving: false }, asOf, null));
  }
  return out.sort((a, b) => (a.state === "done" ? 1 : 0) - (b.state === "done" ? 1 : 0) || (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
}

export interface LadderMonth {
  month: string;
  byKind: Record<ScheduleKind, Paise>;
  total: Paise;
}

/** Month-by-month total of scheduled outflows: shows the commitment load shrinking as things end. */
export function monthlyLadder(items: ScheduleItem[], fromMonth: string, months: number): LadderMonth[] {
  const out: LadderMonth[] = [];
  for (let i = 0; i < months; i++) {
    const m = monthKey(addMonths(monthStart(fromMonth), i));
    const s = monthStart(m);
    const e = monthEnd(m);
    const byKind: Record<ScheduleKind, Paise> = { sip: 0, rd: 0, chit: 0, commitment: 0, emi: 0 };
    for (const it of items) {
      if (it.state === "done") continue;
      byKind[it.kind] += monthly(it.day, it.start, it.end ?? undefined, s, e).length * it.amount;
    }
    out.push({ month: m, byKind, total: Object.values(byKind).reduce((a, b) => a + b, 0) });
  }
  return out;
}

export interface FreedEvent {
  date: ISODate;
  item: ScheduleItem;
  /** Monthly amount that stops after this. */
  freed: Paise;
  daysAway: number;
}

/** "What frees up when": finite schedules in the order they end. */
export function endingEvents(items: ScheduleItem[], asOf: ISODate): FreedEvent[] {
  return items
    .filter((i) => i.end && i.end >= asOf && i.state !== "done")
    .map((item) => ({ date: item.end!, item, freed: item.amount, daysAway: daysBetween(asOf, item.end!) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ScheduleTotals {
  monthlyTotal: Paise;
  savingPerMonth: Paise;
  debtPerMonth: Paise;
  remainingTotal: Paise;
  activeCount: number;
}

export function scheduleTotals(items: ScheduleItem[]): ScheduleTotals {
  const live = items.filter((i) => i.state !== "done" && i.state !== "upcoming");
  return {
    monthlyTotal: live.reduce((s, i) => s + i.amount, 0),
    savingPerMonth: live.filter((i) => i.isSaving).reduce((s, i) => s + i.amount, 0),
    debtPerMonth: live.filter((i) => !i.isSaving).reduce((s, i) => s + i.amount, 0),
    remainingTotal: live.reduce((s, i) => s + (i.remainingAmount ?? 0), 0),
    activeCount: live.length,
  };
}

/**
 * Date of the final instalment of a plan that runs `months` instalments on `day` of the month,
 * starting from `start`. If `day` has already passed in the start month, the first instalment is next month.
 */
export function lastInstalmentDate(start: ISODate, day: number, months: number): ISODate {
  const first = withDay(start, day) >= start ? withDay(start, day) : withDay(addMonths(monthStart(monthKey(start)), 1), day);
  return withDay(addMonths(monthStart(monthKey(first)), Math.max(1, months) - 1), day);
}
