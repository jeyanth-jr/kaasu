/**
 * Query variants for symbol search, most specific first. Spreadsheet names are
 * often misspelt or abbreviated ("PNB Hosuing Finance", "Tata Motors PVL"),
 * and the quote search returns nothing for those, so we fall back to shorter
 * prefixes and then to the distinctive single words.
 */
const GENERIC = new Set(["ltd", "limited", "the", "india", "indian", "co", "company", "corp", "corporation", "and", "&", "of"]);

export function searchVariants(q: string, max = 5): string[] {
  const words = q
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}&\s.-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(words.join(" "));
  for (let n = words.length - 1; n >= 1; n--) push(words.slice(0, n).join(" "));
  // Then distinctive single words, longest first (a misspelt word is usually the odd one out).
  const singles = words.filter((w) => w.length >= 3 && !GENERIC.has(w.toLowerCase())).sort((a, b) => b.length - a.length);
  for (const w of singles) push(w);
  return out.slice(0, max);
}
