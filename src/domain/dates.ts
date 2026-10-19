import type { ISODate } from "./types";

/** Calendar-date helpers on "YYYY-MM-DD" strings, computed in UTC so no TZ drift. */

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now: Date = new Date()): ISODate {
  // Local calendar date of the user, not UTC.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidISO(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = parseISO(d);
  return toISO(dt) === d;
}

const DAY = 86_400_000;

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY);
}

export function addDays(d: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(d).getTime() + n * DAY));
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Add calendar months, clamping the day (31-Jan + 1M → 28/29-Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  const nd = Math.min(day, daysInMonth(ny, nm0));
  return toISO(new Date(Date.UTC(ny, nm0, nd)));
}

/** Date with the given day-of-month in the month of `d`, clamped. */
export function withDay(d: ISODate, day: number): ISODate {
  const [y, m] = d.split("-").map(Number) as [number, number];
  const nd = Math.min(day, daysInMonth(y, m - 1));
  return toISO(new Date(Date.UTC(y, m - 1, nd)));
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function monthStart(month: string): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: string): ISODate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return toISO(new Date(Date.UTC(y, m, 0)));
}

export function addMonthsToKey(month: string, n: number): string {
  return monthKey(addMonths(monthStart(month), n));
}

/** Indian financial year (April–March) containing `d`, e.g. "2025-26". */
export function financialYear(d: ISODate): { label: string; start: ISODate; end: ISODate } {
  const [y, m] = d.split("-").map(Number) as [number, number];
  const startYear = m >= 4 ? y : y - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Years between dates on an actual/365 basis (as used by XIRR). */
export function yearFrac(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / 365;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(d: ISODate, opts: { year?: boolean } = {}): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return opts.year === false ? `${day} ${MONTHS[m - 1]}` : `${day} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Parse user/CSV dates. Supports YYYY-MM-DD, D/M/YYYY, D-M-YYYY, D.M.YY,
 * "21 Mar 2025", "21-Mar-25". `order` resolves numeric ambiguity (India: dmy).
 */
export function parseDateFlexible(text: string, order: "dmy" | "mdy" | "ymd" = "dmy"): ISODate | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return build(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = fullYear(m[3]!);
    if (order === "mdy") return build(y, a, b);
    if (order === "ymd") return null;
    return build(y, b, a);
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m![2]!.slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    return build(fullYear(m[3]!), mi + 1, +m[1]!);
  }
  return null;
}

function fullYear(y: string): number {
  if (y.length === 4) return +y;
  const n = +y;
  return n >= 70 ? 1900 + n : 2000 + n;
}

function build(y: number, m: number, d: number): ISODate | null {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISO(iso) ? iso : null;
}
