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
      if (/schemes?\s*\(/i.test(line)) category = line.replace(/^.*?\(|\)\s*$/g, "").trim();
      else fundHouse = line;
      continue;
    }
    const parts = line.split(";").map((p) => p.trim());
    if (/^scheme\s*code$/i.test(parts[0] ?? "")) {
      layout = layoutFromHeader(parts) ?? LEGACY;
      continue;
    }
    const code = parts[layout.code];
    if (!code || !/^\d+$/.test(code)) continue;
    const nav = Number(parts[layout.nav]);
    const date = amfiDate(parts[layout.date] ?? "");
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue;
    const isinG = parts[layout.isinG];
    const isinR = parts[layout.isinR];
    const extras = [layout.plan, layout.option].map((i) => (i === null ? "" : (parts[i] ?? ""))).filter(Boolean);
    const baseName = parts[layout.name] ?? "";
    out.push({
      code,
      name: extras.length ? `${baseName} - ${extras.join(" - ")}` : baseName,
      isinGrowth: isinG && isinG !== "-" ? isinG : undefined,
      isinReinvest: isinR && isinR !== "-" ? isinR : undefined,
      nav,
      date,
      fundHouse,
      category,
    });
  }
  return out;
}

/** Rank scheme-name matches: all words present, preferring Direct Growth plans. */
export function searchSchemes(schemes: AmfiScheme[], q: string, limit = 20): AmfiScheme[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (/^\d+$/.test(q.trim())) return schemes.filter((s) => s.code.startsWith(q.trim())).slice(0, limit);
  const scored: { s: AmfiScheme; score: number }[] = [];
  for (const s of schemes) {
    const n = s.name.toLowerCase();
    if (!words.every((w) => n.includes(w))) continue;
    let score = 0;
    if (/direct/.test(n)) score += 2;
    if (/growth/.test(n)) score += 2;
    if (/idcw|dividend|bonus/.test(n)) score -= 2;
    if (n.startsWith(words[0]!)) score += 1;
    score -= n.length / 200;
    scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}
