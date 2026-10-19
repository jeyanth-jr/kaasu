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

export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  let category: string | undefined;
  let fundHouse: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes(";")) {
      // Headings alternate between "Open Ended Schemes(Equity Scheme - Large Cap Fund)" and fund-house names.
      if (/schemes?\s*\(/i.test(line)) category = line.replace(/^.*?\(|\)\s*$/g, "").trim();
      else fundHouse = line;
      continue;
    }
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const [code, isinG, isinR, name, navText, dateText] = parts.map((p) => p.trim());
    if (!code || !/^\d+$/.test(code)) continue; // header row
    const nav = Number(navText);
    const date = amfiDate(dateText ?? "");
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue;
    out.push({
      code,
      name: name ?? "",
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
