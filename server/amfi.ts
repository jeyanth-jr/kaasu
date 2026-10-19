/** Parser for AMFI's NAVAll.txt (semicolon-separated, with section headings). */

export interface AmfiScheme {
  code: string;
  name: string;
  isinGrowth?: string;
  isinReinvest?: string;
  nav: number;
  /** ISO date of the NAV. */
  date: string;
  fundHouse?: string;
  category?: string;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "17-Oct-2025" → "2025-10-17" */
export function amfiDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2]!.toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}`;
}

interface Layout {
  code: number;
  isinG: number;
  isinR: number;
  name: number;
  plan: number | null;
  option: number | null;
  nav: number;
  date: number;
}

/** The classic 6-column layout, used until a header row says otherwise. */
const LEGACY: Layout = { code: 0, isinG: 1, isinR: 2, name: 3, plan: null, option: null, nav: 4, date: 5 };

/** Read column positions from the header row, so added columns (e.g. Plan, Option) don't break parsing. */
function layoutFromHeader(cols: string[]): Layout | null {
  const find = (re: RegExp) => {
    const i = cols.findIndex((c) => re.test(c.trim()));
    return i >= 0 ? i : null;
  };
  const code = find(/^scheme\s*code$/i);
  const name = find(/^scheme\s*name$/i);
  const nav = find(/net\s*asset\s*value|^nav$/i);
  const date = find(/^date$/i);
  if (code === null || name === null || nav === null || date === null) return null;
  return {
    code,
    name,
    nav,
    date,
    isinG: find(/growth/i) ?? 1,
    isinR: find(/reinvest/i) ?? 2,
    plan: find(/^plan$/i),
    option: find(/^option$/i),
  };
}

function parseLine(line: string, layout: Layout, fundHouse: string | undefined, category: string | undefined): AmfiScheme | null {
  const parts = line.split(";").map((p) => p.trim());
  const code = parts[layout.code];
  if (!code || !/^\d+$/.test(code)) return null;
  const nav = Number(parts[layout.nav]);
  const date = amfiDate(parts[layout.date] ?? "");
  if (!Number.isFinite(nav) || nav <= 0 || !date) return null;
  const isinG = parts[layout.isinG];
  const isinR = parts[layout.isinR];
  const extras = [layout.plan, layout.option].map((i) => (i === null ? "" : (parts[i] ?? ""))).filter(Boolean);
  const baseName = parts[layout.name] ?? "";
  return {
    code,
    name: extras.length ? `${baseName} - ${extras.join(" - ")}` : baseName,
    isinGrowth: isinG && isinG !== "-" ? isinG : undefined,
    isinReinvest: isinR && isinR !== "-" ? isinR : undefined,
    nav,
    date,
    fundHouse,
    category,
  };
}

const CATEGORY_RE = /schemes?\s*\(/i;
const categoryOf = (heading: string) => heading.replace(/^.*?\(|\)\s*$/g, "").trim();

export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  let category: string | undefined;
  let fundHouse: string | undefined;
  let layout = LEGACY;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes(";")) {
      // Headings alternate between "Open Ended Schemes(Equity Scheme - Large Cap Fund)" and fund-house names.
      if (CATEGORY_RE.test(line)) category = categoryOf(line);
      else fundHouse = line;
      continue;
    }
    if (/^scheme\s*code\s*;/i.test(line)) {
      layout = layoutFromHeader(line.split(";")) ?? LEGACY;
      continue;
    }
    const s = parseLine(line, layout, fundHouse, category);
    if (s) out.push(s);
  }
  return out;
}

function scoreScheme(name: string, words: string[]): number | null {
  const n = name.toLowerCase();
  if (!words.every((w) => n.includes(w))) return null;
  let score = 0;
  if (/direct/.test(n)) score += 2;
  if (/growth/.test(n)) score += 2;
  if (/idcw|dividend|bonus/.test(n)) score -= 2;
  if (n.startsWith(words[0]!)) score += 1;
  return score - n.length / 200;
}

/** Rank scheme-name matches: all words present, preferring Direct Growth plans. */
export function searchSchemes(schemes: AmfiScheme[], q: string, limit = 20): AmfiScheme[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (/^\d+$/.test(q.trim())) return schemes.filter((s) => s.code.startsWith(q.trim())).slice(0, limit);
  const scored: { s: AmfiScheme; score: number }[] = [];
  for (const s of schemes) {
    const score = scoreScheme(s.name, words);
    if (score !== null) scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

/**
 * Lookups over the raw NAVAll text without parsing every line, so a request
 * stays inside a serverless CPU budget: string search is native and fast, and
 * only matching lines are parsed. Results equal parseNavAll's.
 */
export class NavIndex {
  private readonly text: string;
  private lower: string | null = null;
  private readonly layout: Layout;

  constructor(raw: string) {
    this.text = "\n" + raw.replace(/\r/g, "");
    const headerAt = this.text.search(/\nscheme\s*code\s*;/i);
    if (headerAt >= 0) {
      const end = this.text.indexOf("\n", headerAt + 1);
      this.layout = layoutFromHeader(this.text.slice(headerAt + 1, end < 0 ? undefined : end).split(";")) ?? LEGACY;
    } else this.layout = LEGACY;
  }

  private lineAt(pos: number): { start: number; line: string } {
    const start = this.text.lastIndexOf("\n", pos) + 1;
    const end = this.text.indexOf("\n", pos);
    return { start, line: this.text.slice(start, end < 0 ? undefined : end).trim() };
  }

  /** Nearest fund-house and category headings above a scheme line. */
  private headingsAbove(start: number): { fundHouse?: string; category?: string } {
    let fundHouse: string | undefined;
    let pos = start - 1;
    while (pos > 0) {
      const prev = this.text.lastIndexOf("\n", pos - 1);
      const line = this.text.slice(prev + 1, pos).trim();
      pos = prev;
      if (!line || line.includes(";")) continue;
      if (CATEGORY_RE.test(line)) return { fundHouse, category: categoryOf(line) };
      if (fundHouse === undefined) fundHouse = line;
    }
    return { fundHouse };
  }

  private parseAt(start: number, line: string): AmfiScheme | null {
    const h = this.headingsAbove(start);
    return parseLine(line, this.layout, h.fundHouse, h.category);
  }

  get(code: string): AmfiScheme | null {
    const i = this.text.indexOf(`\n${code};`);
    if (i < 0) return null;
    const { start, line } = this.lineAt(i + 1);
    return this.parseAt(start, line);
  }

  search(q: string, limit = 20): AmfiScheme[] {
    const trimmed = q.trim();
    if (!trimmed) return [];
    if (/^\d+$/.test(trimmed)) {
      const out: AmfiScheme[] = [];
      let i = this.text.indexOf(`\n${trimmed}`);
      while (i >= 0 && out.length < limit) {
        const { start, line } = this.lineAt(i + 1);
        const s = /^\d+;/.test(line) ? this.parseAt(start, line) : null;
        if (s) out.push(s);
        i = this.text.indexOf(`\n${trimmed}`, i + 1);
      }
      return out;
    }
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    this.lower ??= this.text.toLowerCase();
    const anchor = [...words].sort((a, b) => b.length - a.length)[0]!;
    const scored: { s: AmfiScheme; score: number }[] = [];
    const seen = new Set<number>();
    let i = this.lower.indexOf(anchor);
    let examined = 0;
    while (i >= 0 && examined < 5000) {
      const { start, line } = this.lineAt(i);
      i = this.lower.indexOf(anchor, start + line.length + 1);
      examined++;
      if (seen.has(start) || !line.includes(";")) continue;
      seen.add(start);
      const lowerLine = line.toLowerCase();
      if (!words.every((w) => lowerLine.includes(w))) continue;
      const s = this.parseAt(start, line);
      if (!s) continue;
      const score = scoreScheme(s.name, words);
      if (score !== null) scored.push({ s, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
  }
}
