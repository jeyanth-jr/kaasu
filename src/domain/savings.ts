import { addMonthsToKey, monthKey } from "./dates";
import { formatCompact } from "./money";
import type { Instrument, Paise, Transaction, TxnType } from "./types";

/**
 * Savings goal, milestones and "wins". Pure logic: the UI decides how to celebrate.
 *
 * "Saved this month" is money you put to work: buys, SIP and RD instalments,
 * deposits into FDs and payments into chits/commitments. It excludes deposits into
 * plain cash accounts (that's just moving money) and sample data.
 */

const SAVING_TYPES: TxnType[] = ["buy", "sip", "deposit", "rd_instalment", "commitment_payment"];

export function isSavingTxn(t: Transaction, byId: Map<string, Instrument>): boolean {
  if (!SAVING_TYPES.includes(t.type) || t.source === "sample") return false;
  const inst = byId.get(t.instrumentId);
  if (!inst || inst.sample) return false;
  return !(t.type === "deposit" && inst.kind === "cash");
}

export function savedInMonth(txns: Transaction[], byId: Map<string, Instrument>, month: string): Paise {
  return txns.filter((t) => monthKey(t.date) === month && isSavingTxn(t, byId)).reduce((s, t) => s + t.amount + (t.charges ?? 0), 0);
}

export type GoalSource = "set" | "plans" | "salary" | "default";

/**
 * The monthly savings target: what you set, else what your SIP/RD/chit plans add up to,
 * else 20% of salary (rounded to ₹500), else ₹10,000.
 */
export function resolveGoal(opts: { goal?: Paise; planned: Paise; salary?: Paise }): { amount: Paise; source: GoalSource } {
  if (opts.goal && opts.goal > 0) return { amount: opts.goal, source: "set" };
  if (opts.planned > 0) return { amount: opts.planned, source: "plans" };
  if (opts.salary && opts.salary > 0) return { amount: Math.max(500_00, Math.round((opts.salary * 0.2) / 500_00) * 500_00), source: "salary" };
  return { amount: 10_000_00, source: "default" };
}

/** Consecutive months, ending at `month`, in which saving reached the goal. 0 if `month` hasn't. */
export function goalStreak(txns: Transaction[], byId: Map<string, Instrument>, month: string, goal: Paise): number {
  let n = 0;
  for (let m = month, i = 0; i < 120; m = addMonthsToKey(m, -1), i++) {
    if (savedInMonth(txns, byId, m) >= goal && goal > 0) n++;
    else break;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Milestones

export const GOAL_STEPS = [25, 50, 75, 100, 150] as const;
/** Net worth levels, in rupees. */
export const NET_WORTH_STEPS = [100_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000] as const;
export const EMERGENCY_STEPS = [1, 3, 6] as const;

export interface SavingsSnapshot {
  month: string;
  saved: Paise;
  goal: Paise;
  netWorth: Paise;
  /** Months of expenses covered by instant cash. */
  emergencyMonths: number;
  /** Saving transactions ever recorded (non-sample). */
  investedCount: number;
  streak: number;
}

export type WinTier = "small" | "medium" | "big";
export type WinKind = "goal" | "streak" | "first" | "networth" | "emergency";

export interface Win {
  key: string;
  kind: WinKind;
  tier: WinTier;
  title: string;
  detail: string;
}

const TIER_RANK: Record<WinTier, number> = { big: 3, medium: 2, small: 1 };
const KIND_RANK: Record<WinKind, number> = { streak: 5, goal: 4, networth: 3, emergency: 2, first: 1 };

const goalCopy: Record<number, { title: string; tier: WinTier }> = {
  25: { title: "Off to a start", tier: "small" },
  50: { title: "Halfway there", tier: "small" },
  75: { title: "Almost there", tier: "medium" },
  100: { title: "Goal smashed", tier: "big" },
  150: { title: "Overachiever", tier: "big" },
};

function lakh(rupees: number): string {
  return formatCompact(rupees * 100).replace("₹", "₹");
}

function describe(key: string, saved?: Paise): Win | null {
  const [kind, a, b] = key.split(":");
  if (kind === "goal" && a && b) {
    const pct = Number(b);
    const c = goalCopy[pct];
    if (!c) return null;
    return { key, kind: "goal", tier: c.tier, title: c.title, detail: saved !== undefined ? `${formatCompact(saved)} saved: ${pct}% of this month's goal` : `${pct}% of the monthly savings goal` };
  }
  if (kind === "streak" && a) return { key, kind: "streak", tier: "big", title: "On a roll", detail: "Savings goal hit again this month" };
  if (kind === "first") return { key, kind: "first", tier: "medium", title: "First investment", detail: "Every portfolio starts with one" };
  if (kind === "nw" && a) {
    const r = Number(a);
    return { key, kind: "networth", tier: r >= 1_000_000 ? "big" : "medium", title: `${lakh(r)} net worth`, detail: "A new level unlocked" };
  }
  if (kind === "emergency" && a) {
    const m = Number(a);
    return { key, kind: "emergency", tier: m >= 6 ? "big" : m >= 3 ? "medium" : "small", title: m >= 6 ? "Emergency fund complete" : `${m} month${m === 1 ? "" : "s"} of runway`, detail: `Instant cash covers ${m} month${m === 1 ? "" : "s"} of expenses` };
  }
  return null;
}

/** Title and copy for a stored win key (for the "Your wins" list). */
export function describeKey(key: string): Win | null {
  return describe(key);
}

/**
 * Milestones crossed between two snapshots, never repeating one already celebrated.
 * `prev === null` is the baseline (first look at the data): nothing is celebrated, so opening
 * the app or syncing a device never replays old achievements. A changed goal also suppresses
 * goal wins for that step, so lowering the goal isn't a "win".
 */
export function detectWins(prev: SavingsSnapshot | null, next: SavingsSnapshot, celebrated: ReadonlySet<string>, opts: { assetWins?: boolean } = {}): Win[] {
  if (!prev) return [];
  const wins: Win[] = [];
  const add = (w: Win | null) => {
    if (w && !celebrated.has(w.key) && !wins.some((x) => x.key === w.key)) wins.push(w);
  };

  if (prev.month === next.month && prev.goal === next.goal && next.goal > 0) {
    const before = (prev.saved / next.goal) * 100;
    const after = (next.saved / next.goal) * 100;
    for (const step of GOAL_STEPS) if (before < step && after >= step) add(describe(`goal:${next.month}:${step}`, next.saved));
    if (before < 100 && after >= 100 && next.streak >= 2) {
      const w = describe(`streak:${next.month}`);
      if (w) add({ ...w, title: `${next.streak} months in a row`, detail: `You've hit your savings goal ${next.streak} months running` });
    }
  }
  if (prev.investedCount === 0 && next.investedCount > 0) add(describe("first:invest"));
  if (opts.assetWins !== false) {
    for (const r of NET_WORTH_STEPS) if (prev.netWorth < r * 100 && next.netWorth >= r * 100) add(describe(`nw:${r}`));
    for (const m of EMERGENCY_STEPS) if (prev.emergencyMonths < m && next.emergencyMonths >= m) add(describe(`emergency:${m}`));
  }
  return wins;
}

/** Which wins to actually show when several land at once: the best ones, biggest first. */
export function pickToShow(wins: Win[], max = 2): Win[] {
  // Among equals, the higher milestone (75% over 25%, 10L over 1L) is the one worth showing.
  const magnitude = (w: Win) => Number(w.key.split(":").at(-1)) || 0;
  return [...wins].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || KIND_RANK[b.kind] - KIND_RANK[a.kind] || magnitude(b) - magnitude(a)).slice(0, max);
}

/** Next unreached goal step for "next: 75% at ₹X" hints. */
export function nextGoalStep(saved: Paise, goal: Paise): { pct: number; amount: Paise } | null {
  if (goal <= 0) return null;
  const pct = (saved / goal) * 100;
  const step = GOAL_STEPS.find((s) => pct < s);
  return step ? { pct: step, amount: Math.round((goal * step) / 100) } : null;
}
