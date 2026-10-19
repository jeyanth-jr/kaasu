import type { Paise } from "./types";

/** Rupees (possibly fractional) → integer paise. */
export function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function toRupees(p: Paise): number {
  return p / 100;
}

/** Value of qty units at a rupee price, in paise. */
export function valueOf(qty: number, price: number): Paise {
  return Math.round(qty * price * 100);
}

/** Group an integer string Indian-style: 1234567 → "12,34,567". */
function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  let rest = intDigits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

export interface FormatOpts {
  /** Show paise (2 decimals). Default false for amounts ≥ ₹100. */
  decimals?: number;
  /** Prefix + for positive values (gains). */
  sign?: boolean;
  /** Omit the ₹ symbol. */
  noSymbol?: boolean;
}

const MINUS = "−"; // typographic minus, readable next to +

/** ₹1,23,456 formatting from paise. */
export function formatINR(p: Paise, opts: FormatOpts = {}): string {
  const decimals = opts.decimals ?? 0;
  const neg = p < 0;
  const abs = Math.abs(p) / 100;
  const fixed = abs.toFixed(decimals);
  const [i = "0", f] = fixed.split(".");
  const body = groupIndian(i) + (f ? `.${f}` : "");
  const isZero = Number(fixed) === 0;
  const sign = neg && !isZero ? MINUS : opts.sign && !isZero ? "+" : "";
  return `${sign}${opts.noSymbol ? "" : "₹"}${body}`;
}

/** Lakh/crore shorthand: ₹12.3L, ₹1.25Cr, ₹45.6K. */
export function formatCompact(p: Paise, opts: { sign?: boolean } = {}): string {
  const neg = p < 0;
  const abs = Math.abs(p) / 100;
  let body: string;
  if (abs >= 1e7) body = `${trim(abs / 1e7)}Cr`;
  else if (abs >= 1e5) body = `${trim(abs / 1e5)}L`;
  else if (abs >= 1e3) body = `${trim(abs / 1e3)}K`;
  else body = abs.toFixed(0);
  const sign = neg && abs >= 0.5 ? MINUS : opts.sign && abs >= 0.5 ? "+" : "";
  return `${sign}₹${body}`;
}

function trim(n: number): string {
  const s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s.replace(/\.?0+$/, "");
}

export function formatPct(x: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const d = opts.decimals ?? 1;
  const fixed = Math.abs(x).toFixed(d);
  const isZero = Number(fixed) === 0;
  const sign = x < 0 && !isZero ? MINUS : opts.sign && !isZero ? "+" : "";
  return `${sign}${fixed}%`;
}

export function formatQty(q: number): string {
  if (Number.isInteger(q)) return groupIndian(String(q));
  const [i = "0", f = ""] = q.toFixed(4).replace(/0+$/, "").split(".");
  return f ? `${groupIndian(i)}.${f}` : groupIndian(i);
}

export function formatPrice(price: number): string {
  const d = price < 1000 && !Number.isInteger(price) ? (price < 100 ? 4 : 2) : 2;
  const fixed = price.toFixed(d).replace(/(\.\d\d)0+$/, "$1");
  const [i = "0", f] = fixed.split(".");
  return `₹${groupIndian(i)}${f ? `.${f}` : ""}`;
}

/**
 * Parse money-ish user/CSV text: "₹1,23,456.50", "(1,200)", "-6,851", "1.2L", "2Cr".
 * Returns rupees or null when the text is not a number.
 */
export function parseAmount(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  let s = text.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹\s]|rs\.?|inr/gi, "").replace(/[−–]/g, "-");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  let mult = 1;
  const suffix = /(cr|crore|l|lakh|lac|k)$/i.exec(s);
  if (suffix) {
    const u = suffix[1]!.toLowerCase();
    mult = u.startsWith("c") ? 1e7 : u === "k" ? 1e3 : 1e5;
    s = s.slice(0, -suffix[1]!.length);
  }
  s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s) * mult;
  return neg ? -n : n;
}

/**
 * Whether a salary looks like a typo (an extra zero or a missing one): far from the usual amount,
 * or very large when there is nothing to compare with. The app asks to confirm rather than refusing.
 */
export function salaryLooksOff(amount: Paise, usual?: Paise | null): boolean {
  if (!(amount > 0)) return false;
  if (usual && usual > 0) return amount >= usual * 4 || amount * 4 <= usual;
  return amount >= 10_00_000_00;
}

export function roundQty(q: number): number {
  return Math.round(q * 1e4) / 1e4;
}
