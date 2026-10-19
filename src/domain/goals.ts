import { addMonths, daysBetween } from "./dates";
import type { ISODate, Paise } from "./types";

/**
 * Money goals: things to save up for, short or long term, separate from the investments held.
 * A goal's progress is what has been put aside for it (deposits less withdrawals) plus the current
 * value of any holdings the user linked to it.
 */

export type GoalTerm = "short" | "long";

export interface Goal {
  id: string;
  name: string;
  /** Key into the goal icon set. */
  icon: string;
  term: GoalTerm;
  target: Paise;
  targetDate?: ISODate;
  startDate: ISODate;
  /** Expected yearly return on money set aside, used to work out the monthly amount needed. */
  ratePct?: number;
  /** Holdings counted toward this goal at their current value. */
  linkedInstrumentIds?: string[];
  note?: string;
  archived?: boolean;
  completedAt?: ISODate;
  sample?: boolean;
  createdAt: string;
}

/** Money put aside (positive) or taken back out (negative). */
export interface GoalFund {
  id: string;
  goalId: string;
  date: ISODate;
  amount: Paise;
  note?: string;
  sample?: boolean;
  createdAt: string;
}

/** Up to three years away is short term. */
export const SHORT_TERM_MONTHS = 36;

export function monthsBetween(from: ISODate, to: ISODate): number {
  const m = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return to.slice(8, 10) > from.slice(8, 10) ? m + 1 : m;
}

export function termFor(targetDate: ISODate | undefined, today: ISODate): GoalTerm {
  if (!targetDate) return "long";
  return monthsBetween(today, targetDate) <= SHORT_TERM_MONTHS ? "short" : "long";
}

export type GoalStatus = "done" | "ahead" | "on-track" | "behind" | "overdue" | "no-date";

export interface GoalProgress {
  saved: Paise;
  contributed: Paise;
  linked: Paise;
  remaining: Paise;
  /** 0 to 1 (can exceed 1 once passed). */
  fraction: number;
  done: boolean;
  /** Whole months until the target date (at least 1 while it is in the future), or null with no date. */
  monthsLeft: number | null;
  /** What to put aside each month from now to get there. */
  requiredMonthly: Paise | null;
  /** Where a steady plan from the start date would have you by now. */
  expectedByNow: Paise | null;
  /** Average put aside per month over the last three months. */
  recentMonthly: Paise;
  /** When the current pace reaches the target, if it does. */
  projectedDate: ISODate | null;
  status: GoalStatus;
}

export function requiredMonthly(remainingAfterGrowth: { target: Paise; saved: Paise; months: number; ratePct: number }): Paise {
  const { target, saved, months, ratePct } = remainingAfterGrowth;
  if (months <= 0) return Math.max(0, target - saved);
  const r = ratePct / 100 / 12;
  if (r === 0) return Math.max(0, Math.ceil((target - saved) / months));
  const growth = Math.pow(1 + r, months);
  const need = target - saved * growth;
  if (need <= 0) return 0;
  return Math.ceil((need * r) / (growth - 1));
}

export function goalProgress(input: { goal: Goal; funds: GoalFund[]; linkedValue: Paise; today: ISODate }): GoalProgress {
  const { goal, funds, linkedValue, today } = input;
  const contributed = funds.filter((f) => f.goalId === goal.id).reduce((s, f) => s + f.amount, 0);
  const saved = Math.max(0, contributed + linkedValue);
  const remaining = Math.max(0, goal.target - saved);
  const done = goal.target > 0 && saved >= goal.target;
  const fraction = goal.target > 0 ? saved / goal.target : 0;

  const monthsLeft = goal.targetDate ? (goal.targetDate > today ? Math.max(1, monthsBetween(today, goal.targetDate)) : 0) : null;
  const required = goal.targetDate && monthsLeft !== null ? requiredMonthly({ target: goal.target, saved, months: monthsLeft, ratePct: goal.ratePct ?? 0 }) : null;

  let expectedByNow: Paise | null = null;
  if (goal.targetDate && goal.targetDate > goal.startDate) {
    const total = daysBetween(goal.startDate, goal.targetDate);
    const elapsed = Math.min(total, Math.max(0, daysBetween(goal.startDate, today)));
    expectedByNow = Math.round((goal.target * elapsed) / total);
  }

  const cutoff = addMonths(today, -3);
  const recent = funds.filter((f) => f.goalId === goal.id && f.date > cutoff && f.date <= today).reduce((s, f) => s + f.amount, 0);
  const recentMonthly = Math.max(0, Math.round(recent / 3));
  const projectedDate = done ? null : recentMonthly > 0 ? addMonths(today, Math.ceil(remaining / recentMonthly)) : null;

  let status: GoalStatus;
  if (done) status = "done";
  else if (!goal.targetDate) status = "no-date";
  else if (goal.targetDate < today) status = "overdue";
  else if (expectedByNow === null || expectedByNow === 0) status = "on-track";
  else if (saved >= expectedByNow * 1.05) status = "ahead";
  else if (saved < expectedByNow * 0.9) status = "behind";
  else status = "on-track";

  return { saved, contributed, linked: linkedValue, remaining, fraction, done, monthsLeft, requiredMonthly: required, expectedByNow, recentMonthly, projectedDate, status };
}

export const STATUS_LABEL: Record<GoalStatus, string> = {
  done: "Reached",
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
  overdue: "Past target date",
  "no-date": "No date set",
};

/** Milestones (percent) a contribution has just crossed, in ascending order. */
export function crossedMilestones(beforeFraction: number, afterFraction: number): number[] {
  return [25, 50, 75, 100].filter((m) => beforeFraction < m / 100 && afterFraction >= m / 100);
}

export interface GoalTemplate {
  key: string;
  name: string;
  icon: string;
  term: GoalTerm;
  /** Suggested months to the target date. */
  months: number;
  hint: string;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { key: "emergency", name: "Emergency fund", icon: "shield", term: "short", months: 12, hint: "3 to 6 months of expenses" },
  { key: "trip", name: "Trip", icon: "plane", term: "short", months: 8, hint: "Flights, stay and fun" },
  { key: "gadget", name: "Phone or laptop", icon: "laptop", term: "short", months: 6, hint: "Upgrade without the EMI" },
  { key: "wedding", name: "Wedding", icon: "ring", term: "long", months: 30, hint: "The big day" },
  { key: "vehicle", name: "Car or bike", icon: "car", term: "long", months: 30, hint: "Down payment or full price" },
  { key: "home", name: "Home down payment", icon: "home", term: "long", months: 60, hint: "20% of the property" },
  { key: "education", name: "Education", icon: "graduation", term: "long", months: 48, hint: "Course, college or abroad" },
  { key: "retire", name: "Retirement", icon: "palmtree", term: "long", months: 240, hint: "Freedom at your own pace" },
  { key: "custom", name: "Something else", icon: "target", term: "short", months: 12, hint: "Name your own goal" },
];
