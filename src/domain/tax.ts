import { addDays, addMonths, daysBetween, financialYear } from "./dates";
import type { Lot, RealizedLot } from "./lots";
import { valueOf } from "./money";
import type { ISODate, Paise, TaxClass, TaxConfig } from "./types";

/**
 * Indian capital-gains helpers. All rates/thresholds come from TaxConfig so a
 * budget change is a settings edit. Scope and simplifications (documented in
 * the README): no surcharge, no carry-forward of prior-year losses, no 31-Jan-2018
 * grandfathering, no basic-exemption adjustment.
 */

export type Term = "short" | "long";

export function ltMonthsFor(taxClass: TaxClass, cfg: TaxConfig): number | null {
  switch (taxClass) {
    case "equity":
      return cfg.equityLtMonths;
    case "listedOther":
      return cfg.listedOtherLtMonths;
    case "unlistedOther":
      return cfg.unlistedOtherLtMonths;
    default:
      return null; // slab-taxed: no long-term treatment
  }
}

/**
 * First date on which a lot bought on `buyDate` counts as long-term. The law
 * says "held for more than 12 months", so a lot bought 15-Jan-2025 is
 * long-term when sold on or after 16-Jan-2026.
 */
export function longTermFrom(buyDate: ISODate, months: number): ISODate {
  return addDays(addMonths(buyDate, months), 1);
}

export function termOf(taxClass: TaxClass, buyDate: ISODate, sellDate: ISODate, cfg: TaxConfig): Term {
  const months = ltMonthsFor(taxClass, cfg);
  if (months === null) return "short";
  return sellDate >= longTermFrom(buyDate, months) ? "long" : "short";
}

export function holdingDays(buyDate: ISODate, asOf: ISODate): number {
  return daysBetween(buyDate, asOf);
}

export type Bucket = "equitySt" | "equityLt" | "otherSt" | "listedLt" | "unlistedLt" | "slab";

export const BUCKET_LABEL: Record<Bucket, string> = {
  equitySt: "Equity STCG",
  equityLt: "Equity LTCG",
  otherSt: "Other STCG (slab)",
  listedLt: "Listed LTCG (non-equity)",
  unlistedLt: "Unlisted LTCG",
  slab: "Slab-taxed gains (debt funds)",
};

const ST_BUCKETS: Bucket[] = ["equitySt", "otherSt", "slab"];
const LT_BUCKETS: Bucket[] = ["listedLt", "unlistedLt", "equityLt"]; // set-off order: no-exemption first

export function bucketOf(taxClass: TaxClass, term: Term): Bucket | null {
  switch (taxClass) {
    case "equity":
      return term === "long" ? "equityLt" : "equitySt";
    case "listedOther":
      return term === "long" ? "listedLt" : "otherSt";
    case "unlistedOther":
      return term === "long" ? "unlistedLt" : "otherSt";
    case "slab":
      return "slab";
    case "none":
      return null;
  }
}

/** Effective rate (%) for a bucket, cess included. */
export function bucketRate(b: Bucket, cfg: TaxConfig): number {
  const c = 1 + cfg.cessPct / 100;
  switch (b) {
    case "equitySt":
      return cfg.equityStcgPct * c;
    case "equityLt":
      return cfg.equityLtcgPct * c;
    case "listedLt":
      return cfg.listedOtherLtcgPct * c;
    case "unlistedLt":
      return cfg.unlistedOtherLtcgPct * c;
    case "otherSt":
    case "slab":
      return cfg.slabPct; // slab rate is entered inclusive of cess
  }
}

export type BucketAmounts = Record<Bucket, Paise>;

export function emptyBuckets(): BucketAmounts {
  return { equitySt: 0, equityLt: 0, otherSt: 0, listedLt: 0, unlistedLt: 0, slab: 0 };
}

export interface GainItem {
  taxClass: TaxClass;
  buyDate: ISODate;
  sellDate: ISODate;
  gain: Paise;
}

export function bucketize(items: GainItem[], cfg: TaxConfig): BucketAmounts {
  const b = emptyBuckets();
  for (const it of items) {
    const k = bucketOf(it.taxClass, termOf(it.taxClass, it.buyDate, it.sellDate, cfg));
    if (k) b[k] += it.gain;
  }
  return b;
}

export interface TaxComputation {
  /** Net gains per bucket after intra-year set-off. */
  net: BucketAmounts;
  taxByBucket: BucketAmounts;
  tax: Paise;
  exemptionUsed: Paise;
  exemptionRemaining: Paise;
  /** Losses that could not be absorbed this year (would carry forward). */
  unabsorbedSt: Paise;
  unabsorbedLt: Paise;
}

/**
 * Intra-year set-off (s.70/s.74 style):
 * - net within each bucket;
 * - short-term losses offset short-term gains (highest rate first), then long-term gains;
 * - long-term losses offset only long-term gains;
 * - long-term gains with no exemption are offset before equity LTCG, which enjoys the exemption;
 * - the ₹1.25L-style exemption then applies to remaining equity LTCG.
 */
export function computeTax(gross: BucketAmounts, cfg: TaxConfig, opts: { exact?: boolean } = {}): TaxComputation {
  const net: BucketAmounts = { ...gross };
  let stLoss = 0;
  let ltLoss = 0;
  for (const k of ST_BUCKETS) if (net[k] < 0) { stLoss += -net[k]; net[k] = 0; }
  for (const k of LT_BUCKETS) if (net[k] < 0) { ltLoss += -net[k]; net[k] = 0; }

  const stByRate = [...ST_BUCKETS].sort((a, b) => bucketRate(b, cfg) - bucketRate(a, cfg));
  for (const k of stByRate) {
    const use = Math.min(stLoss, net[k]);
    net[k] -= use;
    stLoss -= use;
  }
  for (const k of LT_BUCKETS) {
    const useLt = Math.min(ltLoss, net[k]);
    net[k] -= useLt;
    ltLoss -= useLt;
    const useSt = Math.min(stLoss, net[k]);
    net[k] -= useSt;
    stLoss -= useSt;
  }

  const exemptionUsed = Math.min(cfg.equityLtcgExemption, net.equityLt);
  const taxByBucket = emptyBuckets();
  for (const k of [...ST_BUCKETS, ...LT_BUCKETS]) {
    const taxable = k === "equityLt" ? net[k] - exemptionUsed : net[k];
    const raw = (taxable * bucketRate(k, cfg)) / 100;
    taxByBucket[k] = opts.exact ? raw : Math.round(raw);
  }
  const tax = Object.values(taxByBucket).reduce((s, x) => s + x, 0);
  return {
    net,
    taxByBucket,
    tax,
    exemptionUsed,
    exemptionRemaining: cfg.equityLtcgExemption - exemptionUsed,
    unabsorbedSt: stLoss,
    unabsorbedLt: ltLoss,
  };
}

export function addBuckets(a: BucketAmounts, b: BucketAmounts): BucketAmounts {
  const r = emptyBuckets();
  for (const k of Object.keys(r) as Bucket[]) r[k] = a[k] + b[k];
  return r;
}

// ---------------------------------------------------------------------------
// Lot views

export interface LotTaxView {
  instrumentId: string;
  lot: Lot;
  holdingDays: number;
  /** null for slab-taxed instruments, which never become long-term. */
  longTermFrom: ISODate | null;
  term: Term;
  price: number | null;
  value: Paise | null;
  gain: Paise | null;
  bucket: Bucket | null;
}

export function lotViews(
  instrumentId: string,
  taxClass: TaxClass,
  lots: Lot[],
  price: number | null,
  asOf: ISODate,
  cfg: TaxConfig,
): LotTaxView[] {
  const months = ltMonthsFor(taxClass, cfg);
  return lots.map((lot) => {
    const term = termOf(taxClass, lot.date, asOf, cfg);
    const value = price === null ? null : valueOf(lot.qty, price);
    return {
      instrumentId,
      lot,
      holdingDays: holdingDays(lot.date, asOf),
      longTermFrom: months === null ? null : longTermFrom(lot.date, months),
      term,
      price,
      value,
      gain: value === null ? null : value - lot.cost,
      bucket: bucketOf(taxClass, term),
    };
  });
}

export function realizedInFY(
  realized: { taxClass: TaxClass; lot: RealizedLot }[],
  fyOf: ISODate,
): { taxClass: TaxClass; lot: RealizedLot }[] {
  const fy = financialYear(fyOf);
  return realized.filter((r) => r.lot.sellDate >= fy.start && r.lot.sellDate <= fy.end);
}

// ---------------------------------------------------------------------------
// Harvest helper

export interface HarvestInput {
  instrumentId: string;
  taxClass: TaxClass;
  /** Units are whole (shares/ETFs) or fractional (fund units, 0.001). */
  unitStep: number;
  price: number;
  lots: Lot[]; // FIFO order
}

export interface HarvestSuggestion {
  instrumentId: string;
  qty: number;
  proceeds: Paise;
  gain: Paise;
  lotsTouched: number;
}

/**
 * Which units can be sold this FY with zero additional tax, respecting FIFO
 * (a sale always consumes the oldest lots first). Greedy over instruments with
 * the largest long-term gains, checking each step against the full tax engine
 * so set-off and the exemption are applied exactly as in computeTax.
 */
export function harvestZeroTax(
  inputs: HarvestInput[],
  realizedSoFar: BucketAmounts,
  asOf: ISODate,
  cfg: TaxConfig,
): { suggestions: HarvestSuggestion[]; exemptionLeftAfter: Paise; baseTax: Paise } {
  const exact = { exact: true };
  const baseTax = computeTax(realizedSoFar, cfg, exact).tax;
  const zeroExtra = (b: BucketAmounts) => computeTax(b, cfg, exact).tax <= baseTax + 1e-9;
  let acc: BucketAmounts = { ...realizedSoFar };
  const suggestions: HarvestSuggestion[] = [];

  const ranked = [...inputs].sort((a, b) => ltGain(b, asOf, cfg) - ltGain(a, asOf, cfg));
  for (const inp of ranked) {
    const before = acc;
    let qtySold = 0;
    let gainSum = 0;
    let lotsTouched = 0;
    for (const lot of inp.lots) {
      const term = termOf(inp.taxClass, lot.date, asOf, cfg);
      const bucket = bucketOf(inp.taxClass, term);
      if (!bucket) break;
      const gainFor = (q: number) => valueOf(q, inp.price) - Math.round((lot.cost * q) / lot.qty);
      const withQty = (q: number) => {
        const next = { ...acc };
        next[bucket] += gainFor(q);
        return next;
      };
      if (zeroExtra(withQty(lot.qty))) {
        acc = withQty(lot.qty);
        qtySold += lot.qty;
        gainSum += gainFor(lot.qty);
        lotsTouched++;
        continue;
      }
      // Partial lot: largest step-multiple that keeps tax unchanged.
      let lo = 0;
      let hi = Math.floor(lot.qty / inp.unitStep + 1e-9);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (zeroExtra(withQty(mid * inp.unitStep))) lo = mid;
        else hi = mid - 1;
      }
      const q = Math.round(lo * inp.unitStep * 1e6) / 1e6;
      if (q > 0) {
        acc = withQty(q);
        qtySold += q;
        gainSum += gainFor(q);
        lotsTouched++;
      }
      break; // FIFO: later lots can't be reached without selling this one fully
    }
    if (qtySold > 0 && gainSum > 0) {
      suggestions.push({
        instrumentId: inp.instrumentId,
        qty: Math.round(qtySold * 1e6) / 1e6,
        proceeds: valueOf(qtySold, inp.price),
        gain: gainSum,
        lotsTouched,
      });
    } else if (qtySold > 0) {
      // Selling only loss-making units is not "harvesting gains"; roll back.
      acc = before;
    }
  }
  return { suggestions, exemptionLeftAfter: computeTax(acc, cfg).exemptionRemaining, baseTax: Math.round(baseTax) };
}

function ltGain(inp: HarvestInput, asOf: ISODate, cfg: TaxConfig): number {
  let g = 0;
  for (const lot of inp.lots) {
    if (termOf(inp.taxClass, lot.date, asOf, cfg) === "long") g += valueOf(lot.qty, inp.price) - lot.cost;
  }
  return g;
}

export interface TurningLongSoon {
  instrumentId: string;
  lot: Lot;
  longTermFrom: ISODate;
  daysLeft: number;
  gain: Paise;
  /** Rough tax saved by waiting, at today's price (ignores exemption usage). */
  taxSaved: Paise;
}

export function turningLongSoon(
  instrumentId: string,
  taxClass: TaxClass,
  lots: Lot[],
  price: number,
  asOf: ISODate,
  withinDays: number,
  cfg: TaxConfig,
): TurningLongSoon[] {
  const months = ltMonthsFor(taxClass, cfg);
  if (months === null) return [];
  const st = bucketOf(taxClass, "short")!;
  const lt = bucketOf(taxClass, "long")!;
  const out: TurningLongSoon[] = [];
  for (const lot of lots) {
    const from = longTermFrom(lot.date, months);
    const daysLeft = daysBetween(asOf, from);
    if (daysLeft <= 0 || daysLeft > withinDays) continue;
    const gain = valueOf(lot.qty, price) - lot.cost;
    if (gain <= 0) continue;
    const taxSaved = Math.round((gain * (bucketRate(st, cfg) - bucketRate(lt, cfg))) / 100);
    out.push({ instrumentId, lot, longTermFrom: from, daysLeft, gain, taxSaved });
  }
  return out;
}
