import type { Holding } from "./portfolio";
import type { EquitySegment, LookThrough, Paise, Settings } from "./types";

export interface Slice {
  key: string;
  value: Paise;
  pct: number;
  count: number;
}

export interface Exposure {
  name: string;
  sector: string;
  value: Paise;
  pct: number;
  /** Where the exposure comes from: direct holding and/or funds. */
  via: string[];
}

export type FlagKind = "small-position" | "too-many-stocks" | "duplicate-exposure" | "stock-concentration" | "sector-concentration";

export interface Flag {
  kind: FlagKind;
  severity: "info" | "warn";
  title: string;
  detail: string;
  instrumentIds: string[];
}

export interface EquityAnalysis {
  total: Paise;
  bySegment: Slice[];
  bySector: Slice[];
  byType: Slice[];
  exposures: Exposure[];
  lookThroughCoverage: number; // % of fund value with look-through data
  flags: Flag[];
}

const SEGMENT_LABEL: Record<EquitySegment, string> = {
  large: "Large cap",
  mid: "Mid cap",
  small: "Small cap",
  flexi: "Flexi cap",
  multi: "Multi cap",
  index: "Index",
  elss: "ELSS",
  sectoral: "Sectoral / thematic",
  international: "International",
  direct: "Direct stocks",
  other: "Other",
};

export function segmentLabel(s: EquitySegment | undefined): string {
  return SEGMENT_LABEL[s ?? "other"];
}

function slices(map: Map<string, { value: number; count: number }>, total: number): Slice[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, value: v.value, count: v.count, pct: total > 0 ? (v.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

function bump(map: Map<string, { value: number; count: number }>, key: string, value: number, count = 1) {
  const cur = map.get(key) ?? { value: 0, count: 0 };
  cur.value += value;
  cur.count += count;
  map.set(key, cur);
}

/** Latest look-through snapshot per fund at or before `month`. */
export function latestLookThrough(all: LookThrough[], instrumentId: string): LookThrough | null {
  return all.filter((l) => l.instrumentId === instrumentId).sort((a, b) => (a.month < b.month ? 1 : -1))[0] ?? null;
}

function normName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\b(ltd|limited|corp|corporation|inc|the)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function analyzeEquity(holdings: Holding[], lookThrough: LookThrough[], settings: Settings): EquityAnalysis {
  const eq = holdings.filter((h) => h.instrument.assetClass === "equity" && !h.closed && h.value > 0);
  const total = eq.reduce((s, h) => s + h.value, 0);
  const seg = new Map<string, { value: number; count: number }>();
  const sec = new Map<string, { value: number; count: number }>();
  const typ = new Map<string, { value: number; count: number }>();
  const exp = new Map<string, Exposure>();
  let fundValue = 0;
  let coveredFundValue = 0;

  for (const h of eq) {
    const inst = h.instrument;
    const isDirect = inst.kind === "stock";
    bump(seg, segmentLabel(isDirect ? "direct" : inst.segment), h.value);
    bump(typ, isDirect ? "Stocks" : inst.kind === "etf" ? "ETFs" : "Mutual funds", h.value);
    if (isDirect) {
      const sector = inst.sector || "Unclassified";
      bump(sec, sector, h.value);
      addExposure(exp, inst.name, sector, h.value, "direct");
    } else {
      fundValue += h.value;
      const lt = latestLookThrough(lookThrough, inst.id);
      if (lt && lt.holdings.length > 0) {
        coveredFundValue += h.value;
        let covered = 0;
        for (const x of lt.holdings) {
          const v = (h.value * x.weightPct) / 100;
          covered += v;
          const sector = x.sector || "Unclassified";
          bump(sec, sector, v, 0);
          addExposure(exp, x.name, sector, v, inst.name);
        }
        const rest = h.value - covered;
        if (rest > 0) bump(sec, `Rest of ${inst.trackingIndex ? inst.trackingIndex : "funds"} (not looked through)`, rest, 0);
      } else {
        bump(sec, inst.sector || "Diversified fund (no look-through)", h.value, 0);
      }
    }
  }
  for (const [k, v] of sec) if (v.count === 0) sec.set(k, { ...v, count: 1 });

  const exposures = [...exp.values()]
    .map((e) => ({ ...e, pct: total > 0 ? (e.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const flags: Flag[] = [];
  // Clutter: small positions
  const small = eq.filter((h) => h.value < settings.minPositionSize);
  if (small.length > 0) {
    flags.push({
      kind: "small-position",
      severity: "info",
      title: `${small.length} position${small.length > 1 ? "s" : ""} under ${rupees(settings.minPositionSize)}`,
      detail: small.map((h) => h.instrument.name).join(", "),
      instrumentIds: small.map((h) => h.instrument.id),
    });
  }
  const stocks = eq.filter((h) => h.instrument.kind === "stock");
  if (stocks.length > settings.maxDirectStocks) {
    flags.push({
      kind: "too-many-stocks",
      severity: "info",
      title: `${stocks.length} direct stocks (your limit is ${settings.maxDirectStocks})`,
      detail: "More stocks means more tracking with little extra diversification. Consider consolidating into your best convictions or an index fund.",
      instrumentIds: stocks.map((h) => h.instrument.id),
    });
  }
  // Duplicate exposure: same tracking index, or same fund category twice.
  const byIndex = new Map<string, typeof eq>();
  for (const h of eq) {
    const key = h.instrument.trackingIndex?.trim().toUpperCase();
    if (key) byIndex.set(key, [...(byIndex.get(key) ?? []), h]);
  }
  for (const [idx, hs] of byIndex) {
    if (hs.length > 1) {
      flags.push({
        kind: "duplicate-exposure",
        severity: "warn",
        title: `${hs.length} products track ${idx}`,
        detail: `${hs.map((h) => h.instrument.name).join(" and ")} hold the same basket. One is enough.`,
        instrumentIds: hs.map((h) => h.instrument.id),
      });
    }
  }
  const bySeg = new Map<string, typeof eq>();
  for (const h of eq) {
    if (h.instrument.kind === "mf" && h.instrument.segment && h.instrument.segment !== "index" && !h.instrument.trackingIndex) {
      bySeg.set(h.instrument.segment, [...(bySeg.get(h.instrument.segment) ?? []), h]);
    }
  }
  for (const [s, hs] of bySeg) {
    if (hs.length > 1) {
      flags.push({
        kind: "duplicate-exposure",
        severity: "info",
        title: `${hs.length} ${segmentLabel(s as EquitySegment).toLowerCase()} funds`,
        detail: `${hs.map((h) => h.instrument.name).join(", ")} likely overlap heavily.`,
        instrumentIds: hs.map((h) => h.instrument.id),
      });
    }
  }
  // Concentration
  for (const e of exposures) {
    if (e.pct > settings.maxStockPctOfEquity) {
      flags.push({
        kind: "stock-concentration",
        severity: "warn",
        title: `${e.name} is ${e.pct.toFixed(1)}% of equity`,
        detail: `Above your ${settings.maxStockPctOfEquity}% single-stock limit (via ${e.via.join(", ")}).`,
        instrumentIds: [],
      });
    }
  }
  const sectorSlices = slices(sec, total);
  for (const s of sectorSlices) {
    if (s.pct > settings.maxSectorPctOfEquity && !/^Diversified|^Rest of/.test(s.key)) {
      flags.push({
        kind: "sector-concentration",
        severity: "warn",
        title: `${s.key} is ${s.pct.toFixed(1)}% of equity`,
        detail: `Above your ${settings.maxSectorPctOfEquity}% sector limit.`,
        instrumentIds: [],
      });
    }
  }

  return {
    total,
    bySegment: slices(seg, total),
    bySector: sectorSlices,
    byType: slices(typ, total),
    exposures,
    lookThroughCoverage: fundValue > 0 ? (coveredFundValue / fundValue) * 100 : 100,
    flags,
  };
}

function addExposure(map: Map<string, Exposure>, name: string, sector: string, value: number, via: string) {
  const key = normName(name);
  const cur = map.get(key) ?? { name, sector, value: 0, pct: 0, via: [] };
  cur.value += value;
  if (!cur.via.includes(via)) cur.via.push(via);
  map.set(key, cur);
}

function rupees(p: Paise): string {
  return `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
}

/** Parse pasted fund holdings: "HDFC Bank  Financials  9.8%" lines, tab/comma separated. */
export function parseLookThroughPaste(text: string): { holdings: { name: string; sector?: string; weightPct: number }[]; skipped: string[] } {
  const holdings: { name: string; sector?: string; weightPct: number }[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)|\s{2,}|\s*\|\s*/).map((p) => p.trim().replace(/^"|"$/g, "")).filter(Boolean);
    const wIdx = parts.findIndex((p) => /^\d+(\.\d+)?\s*%?$/.test(p));
    if (wIdx < 0) {
      skipped.push(line);
      continue;
    }
    const weightPct = parseFloat(parts[wIdx]!);
    const others = parts.filter((_, i) => i !== wIdx);
    if (!others[0] || weightPct <= 0 || weightPct > 100) {
      skipped.push(line);
      continue;
    }
    holdings.push({ name: others[0], sector: others[1], weightPct });
  }
  return { holdings, skipped };
}
