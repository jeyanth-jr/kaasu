import { addMonths, daysBetween, monthEnd, monthKey, monthStart, parseDateFlexible, withDay } from "./dates";
import { parseAmount, toPaise } from "./money";
import type { ISODate, Paise } from "./types";

/**
 * Day-to-day money: income and spending entries, category budgets, the payday
 * flow and "safe to spend". Investments stay in the portfolio ledger; this is
 * the cash side of the month.
 */

export type EntryKind = "income" | "expense";

export interface CashEntry {
  id: string;
  date: ISODate;
  kind: EntryKind;
  /** Always positive paise; `kind` gives the direction. */
  amount: Paise;
  category: string;
  note?: string;
  /** Cash/savings instrument this hit, if any. */
  accountId?: string;
  /** Portfolio transaction mirrored into the account balance, if any. */
  linkedTxnId?: string;
  source: "manual" | "statement" | "payday" | "sample";
  importBatchId?: string;
  /** Normalised statement fingerprint, used to skip duplicates on re-import. */
  fingerprint?: string;
  createdAt: string;
}

export type CategoryIconKey = "briefcase" | "party" | "undo" | "banknote" | "home" | "cart" | "utensils" | "bus" | "zap" | "tv" | "bag" | "pill" | "film" | "plane" | "users" | "landmark" | "book" | "gift" | "receipt";

export interface Category {
  id: string;
  label: string;
  /** Key into the icon set (kept as a string so the domain layer stays UI-free). */
  icon: CategoryIconKey;
  color: string;
  kind: EntryKind;
}

export const CATEGORIES: Category[] = [
  { id: "salary", label: "Salary", icon: "briefcase", color: "#10b981", kind: "income" },
  { id: "bonus", label: "Bonus", icon: "party", color: "#22c55e", kind: "income" },
  { id: "refund", label: "Refunds", icon: "undo", color: "#14b8a6", kind: "income" },
  { id: "other-income", label: "Other income", icon: "banknote", color: "#84cc16", kind: "income" },
  { id: "rent", label: "Rent", icon: "home", color: "#4f7bc8", kind: "expense" },
  { id: "groceries", label: "Groceries", icon: "cart", color: "#22c55e", kind: "expense" },
  { id: "food", label: "Food & dining", icon: "utensils", color: "#f97316", kind: "expense" },
  { id: "transport", label: "Transport", icon: "bus", color: "#0ea5e9", kind: "expense" },
  { id: "bills", label: "Bills & recharges", icon: "zap", color: "#eab308", kind: "expense" },
  { id: "subscriptions", label: "Subscriptions", icon: "tv", color: "#3f8fb0", kind: "expense" },
  { id: "shopping", label: "Shopping", icon: "bag", color: "#ec4899", kind: "expense" },
  { id: "health", label: "Health", icon: "pill", color: "#ef4444", kind: "expense" },
  { id: "fun", label: "Fun & going out", icon: "film", color: "#c0678f", kind: "expense" },
  { id: "travel", label: "Travel", icon: "plane", color: "#06b6d4", kind: "expense" },
  { id: "family", label: "Family", icon: "users", color: "#f43f5e", kind: "expense" },
  { id: "emi", label: "EMIs & loans", icon: "landmark", color: "#64748b", kind: "expense" },
  { id: "education", label: "Learning", icon: "book", color: "#4aa39b", kind: "expense" },
  { id: "gifts", label: "Gifts", icon: "gift", color: "#fb7185", kind: "expense" },
  { id: "other", label: "Other", icon: "receipt", color: "#94a3b8", kind: "expense" },
];

export const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]));
export function categoryOf(id: string): Category {
  return categoryById.get(id) ?? categoryById.get("other")!;
}

// ---------------------------------------------------------------------------
// Monthly summary

export interface MonthSummary {
  month: string;
  income: Paise;
  expenses: Paise;
  net: Paise;
  /** (income − expenses) / income, null without income. */
  savingsRate: number | null;
  byCategory: { category: Category; amount: Paise; count: number }[];
  /** Cumulative spend by day of month (index 0 = day 1). */
  dailyCumulative: Paise[];
}

export function monthSummary(entries: CashEntry[], month: string): MonthSummary {
  const inMonth = entries.filter((e) => monthKey(e.date) === month);
  let income = 0;
  let expenses = 0;
  const byCat = new Map<string, { amount: number; count: number }>();
  const days = Number(monthEnd(month).slice(8));
  const daily = new Array<number>(days).fill(0);
  for (const e of inMonth) {
    if (e.kind === "income") income += e.amount;
    else {
      expenses += e.amount;
      const c = byCat.get(e.category) ?? { amount: 0, count: 0 };
      c.amount += e.amount;
      c.count++;
      byCat.set(e.category, c);
      daily[Number(e.date.slice(8)) - 1]! += e.amount;
    }
  }
  for (let i = 1; i < daily.length; i++) daily[i]! += daily[i - 1]!;
  return {
    month,
    income,
    expenses,
    net: income - expenses,
    savingsRate: income > 0 ? (income - expenses) / income : null,
    byCategory: [...byCat.entries()].map(([id, v]) => ({ category: categoryOf(id), ...v })).sort((a, b) => b.amount - a.amount),
    dailyCumulative: daily,
  };
}

export interface BudgetLine {
  category: Category;
  budget: Paise;
  spent: Paise;
  /** spent / budget; >1 means over. 0 when there is no budget. */
  ratio: number;
  /** "none": spending in a category you haven't budgeted for. */
  status: "ok" | "near" | "over" | "none";
}

export function budgetLines(summary: MonthSummary, budgets: Record<string, Paise>): BudgetLine[] {
  const spentBy = new Map(summary.byCategory.map((c) => [c.category.id, c.amount]));
  const ids = new Set([...Object.keys(budgets).filter((k) => (budgets[k] ?? 0) > 0), ...spentBy.keys()]);
  return [...ids]
    .map((id) => {
      const budget = budgets[id] ?? 0;
      const spent = spentBy.get(id) ?? 0;
      if (budget <= 0) return { category: categoryOf(id), budget: 0, spent, ratio: 0, status: "none" } as BudgetLine;
      const ratio = spent / budget;
      return { category: categoryOf(id), budget, spent, ratio, status: ratio > 1 ? "over" : ratio >= 0.8 ? "near" : "ok" } as BudgetLine;
    })
    .sort((a, b) => b.spent - a.spent || b.budget - a.budget);
}

// ---------------------------------------------------------------------------
// Payday

export interface SalaryPlan {
  /** Expected net (in-hand) salary. */
  amount: Paise;
  /** Usual credit day of month. */
  day: number;
  accountId?: string;
  employer?: string;
}

export type PaydayStatus =
  | { state: "not-set" }
  | { state: "upcoming"; expectedOn: ISODate; daysLeft: number }
  | { state: "due"; expectedOn: ISODate; daysLate: number }
  | { state: "received"; on: ISODate; amount: Paise };

/**
 * Has this month's salary arrived? "Due" from the expected day (pulled back to
 * Friday when it falls on a weekend, as payroll usually is) until a salary
 * entry is recorded for the month.
 */
export function paydayStatus(salary: SalaryPlan | null | undefined, entries: CashEntry[], today: ISODate): PaydayStatus {
  if (!salary || salary.amount <= 0) return { state: "not-set" };
  const month = monthKey(today);
  const got = entries.filter((e) => e.kind === "income" && e.category === "salary" && monthKey(e.date) === month).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (got.length) return { state: "received", on: got[0]!.date, amount: got.reduce((s, e) => s + e.amount, 0) };
  const expectedOn = businessDayOnOrBefore(withDay(today, salary.day));
  const diff = daysBetween(today, expectedOn);
  return diff > 0 ? { state: "upcoming", expectedOn, daysLeft: diff } : { state: "due", expectedOn, daysLate: -diff };
}

export function businessDayOnOrBefore(d: ISODate): ISODate {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  if (wd === 6) return withDay(d, Number(d.slice(8)) - 1);
  if (wd === 0) return withDay(d, Number(d.slice(8)) - 2);
  return d;
}

export interface SafeToSpend {
  /** Salary received this month, or the expected salary if it hasn't landed yet. */
  income: Paise;
  incomeIsExpected: boolean;
  /** Planned investments and commitments for the month (the monthly plan, excluding the buffer line). */
  committed: Paise;
  spent: Paise;
  left: Paise;
  daysLeft: number;
  perDay: Paise;
}

export function safeToSpend(input: { summary: MonthSummary; salary: SalaryPlan | null | undefined; committed: Paise; today: ISODate }): SafeToSpend {
  const { summary, salary, committed, today } = input;
  const incomeIsExpected = summary.income === 0 && !!salary && salary.amount > 0;
  const income = incomeIsExpected ? salary!.amount : summary.income;
  const left = income - committed - summary.expenses;
  const end = monthEnd(summary.month);
  const daysLeft = monthKey(today) === summary.month ? daysBetween(today, end) + 1 : today < monthStart(summary.month) ? Number(end.slice(8)) : 0;
  return { income, incomeIsExpected, committed, spent: summary.expenses, left, daysLeft, perDay: daysLeft > 0 ? Math.floor(Math.max(0, left) / daysLeft) : 0 };
}

/** Consecutive past months (newest first, excluding the current one) where you saved at least `minRate`. */
export function savingsStreak(entries: CashEntry[], today: ISODate, minRate = 0.2): number {
  let streak = 0;
  for (let i = 1; i <= 60; i++) {
    const m = monthKey(addMonths(today, -i));
    const s = monthSummary(entries, m);
    if (s.savingsRate === null || s.savingsRate < minRate) break;
    streak++;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Bank statement import

const RULES: [RegExp, string][] = [
  [/\b(salary|sal\s*cr|sal\/|payroll|neft.*sal)\b/i, "salary"],
  [/\b(bonus|incentive)\b/i, "bonus"],
  [/\b(refund|reversal|cashback)\b/i, "refund"],
  [/\b(swiggy|zomato|eatsure|dominos|domino|mcdonald|kfc|starbucks|cafe|restaurant|dunzo daily|blinkit cafe)\b/i, "food"],
  [/\b(bigbasket|big basket|blinkit|zepto|instamart|dmart|jiomart|grofers|more retail|reliance fresh|nature'?s basket)\b/i, "groceries"],
  [/\b(uber|ola|rapido|metro|irctc|redbus|fastag|petrol|fuel|indian oil|hpcl|bpcl|shell)\b/i, "transport"],
  [/\b(electricity|bescom|tneb|tangedco|msedcl|bses|water bill|gas bill|indane|airtel|jio|vi\b|vodafone|bsnl|act fibernet|broadband|recharge|dth|tata play)\b/i, "bills"],
  [/\b(netflix|spotify|prime video|amazon prime|hotstar|youtube premium|apple\.com|google play|icloud|chatgpt|openai|claude|anthropic)\b/i, "subscriptions"],
  [/\b(amazon|flipkart|myntra|ajio|meesho|nykaa|tata cliq|croma|decathlon|ikea)\b/i, "shopping"],
  [/\b(pharmacy|apollo|medplus|1mg|pharmeasy|netmeds|hospital|clinic|diagnostic|practo)\b/i, "health"],
  [/\b(bookmyshow|pvr|inox|steam|playstation|district)\b/i, "fun"],
  [/\b(makemytrip|goibibo|cleartrip|indigo|air india|vistara|akasa|oyo|airbnb|booking\.com|agoda)\b/i, "travel"],
  [/\b(rent|nobroker|landlord)\b/i, "rent"],
  [/\b(emi|loan|bajaj finance|home credit|ach d|nach)\b/i, "emi"],
  [/\b(udemy|coursera|byju|unacademy|school fee|college|tuition)\b/i, "education"],
];

export function categorize(description: string, kind: EntryKind): string {
  for (const [re, cat] of RULES) {
    if (re.test(description) && categoryOf(cat).kind === kind) return cat;
  }
  return kind === "income" ? "other-income" : "other";
}

export interface StatementRow {
  line: number;
  date: ISODate;
  description: string;
  kind: EntryKind;
  amount: Paise;
  category: string;
  fingerprint: string;
}

export interface StatementMapping {
  headerRow: number;
  date: number;
  description: number;
  debit?: number;
  credit?: number;
  /** Single signed amount column (negative = debit), or with a Dr/Cr column. */
  amount?: number;
  drcr?: number;
}

const H = {
  date: /^(txn |transaction |value |posting )?date$|^date$/i,
  description: /narration|description|particulars|details|remarks/i,
  debit: /withdrawal|debit|dr\.?\s*amount|^dr$|paid out/i,
  credit: /deposit|credit|cr\.?\s*amount|^cr$|paid in/i,
  amount: /^(txn |transaction )?amount( \(inr\))?$/i,
  drcr: /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type)$/i,
};

/** Find the header row and columns of a bank statement CSV (HDFC/ICICI/SBI/Axis style). */
export function guessStatementMapping(rows: string[][]): StatementMapping | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r]!.map((c) => c.trim());
    const find = (re: RegExp) => {
      const i = row.findIndex((c) => re.test(c));
      return i >= 0 ? i : undefined;
    };
    const date = find(H.date);
    const description = find(H.description);
    if (date === undefined || description === undefined) continue;
    const debit = find(H.debit);
    const credit = find(H.credit);
    const amount = find(H.amount);
    if ((debit !== undefined && credit !== undefined) || amount !== undefined) {
      return { headerRow: r, date, description, debit, credit, amount, drcr: find(H.drcr) };
    }
  }
  return null;
}

export function fingerprint(date: ISODate, amount: Paise, kind: EntryKind, description: string): string {
  return `${date}|${kind}|${amount}|${description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)}`;
}

export function parseStatement(rows: string[][], m: StatementMapping, dateOrder: "dmy" | "mdy" | "ymd" = "dmy"): { rows: StatementRow[]; skipped: number } {
  const out: StatementRow[] = [];
  let skipped = 0;
  for (let r = m.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const date = parseDateFlexible((row[m.date] ?? "").trim(), dateOrder);
    const description = (row[m.description] ?? "").replace(/\s+/g, " ").trim();
    if (!date) {
      if (row.some((c) => c.trim())) skipped++;
      continue;
    }
    let kind: EntryKind | null = null;
    let rupees: number | null = null;
    if (m.debit !== undefined && m.credit !== undefined) {
      const dr = parseAmount(row[m.debit] ?? "");
      const cr = parseAmount(row[m.credit] ?? "");
      if (dr && Math.abs(dr) > 0) [kind, rupees] = ["expense", Math.abs(dr)];
      else if (cr && Math.abs(cr) > 0) [kind, rupees] = ["income", Math.abs(cr)];
    } else if (m.amount !== undefined) {
      const a = parseAmount(row[m.amount] ?? "");
      if (a !== null && a !== 0) {
        const flag = m.drcr !== undefined ? (row[m.drcr] ?? "").trim().toLowerCase() : "";
        const isDebit = flag ? flag.startsWith("d") : a < 0;
        [kind, rupees] = [isDebit ? "expense" : "income", Math.abs(a)];
      }
    }
    if (!kind || !rupees) {
      skipped++;
      continue;
    }
    const amount = toPaise(rupees);
    out.push({ line: r + 1, date, description, kind, amount, category: categorize(description, kind), fingerprint: fingerprint(date, amount, kind, description) });
  }
  return { rows: out, skipped };
}
