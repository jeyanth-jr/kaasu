import { searchKnownSymbols, type KnownSymbol } from "../data/symbols";
import { normalizeName, type ParsedRow } from "./csv";
import type { Instrument } from "./types";

/**
 * Which existing holding each imported row belongs to (by symbol, AMFI code,
 * then exact normalised name). Sample holdings are never candidates, so real
 * entries can't be merged into the fictional demo portfolio.
 */
export function matchExisting(rows: ParsedRow[], instruments: Instrument[]): Map<number, Instrument | null> {
  const bySym = new Map<string, Instrument>();
  const byName = new Map<string, Instrument>();
  for (const i of instruments) {
    if (i.sample) continue;
    const d = i.details;
    if ((d.kind === "stock" || d.kind === "etf" || d.kind === "gold") && d.symbol) bySym.set(d.symbol.toUpperCase(), i);
    if (d.kind === "mf" && d.amfiCode) bySym.set(`AMFI:${d.amfiCode}`, i);
    byName.set(normalizeName(i.name), i);
  }
  const m = new Map<number, Instrument | null>();
  for (const r of rows) {
    m.set(r.line, (r.symbol && bySym.get(r.symbol)) || (r.amfiCode && bySym.get(`AMFI:${r.amfiCode}`)) || byName.get(normalizeName(r.name)) || null);
  }
  return m;
}

/**
 * Auto-assign a symbol only when the sheet name clearly is that company.
 * "Tata Motors PVL" must not become "Tata Motors": extra words may name a
 * different security, so anything unsure is left for "Link price sources".
 */
export function confidentKnownMatch(name: string): KnownSymbol | undefined {
  const n = normalizeName(name);
  if (n.length < 3) return undefined;
  return searchKnownSymbols(name, 3).find((k) => {
    const kn = normalizeName(k.name);
    return kn === n || kn.startsWith(n) || k.symbol.toLowerCase() === n;
  });
}
