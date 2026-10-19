/**
 * Core data model. Conventions:
 * - Money amounts are integer paise (₹1 = 100). Prices per unit are plain
 *   rupee numbers (NAVs carry 4 decimals) and are converted at valuation.
 * - Quantities are plain numbers rounded to 4 decimals at input.
 * - Dates are ISO calendar dates "YYYY-MM-DD" (no time zone).
 * Holdings, lots, P/L and XIRR are always derived from transactions.
 */

export type ISODate = string; // YYYY-MM-DD
export type Paise = number;

export type InstrumentKind =
  | "stock"
  | "etf"
  | "mf"
  | "rd"
  | "fd"
  | "bond"
  | "gold"
  | "cash"
  | "commitment";

export type AssetClass = "equity" | "debt" | "gold" | "cash" | "other";
export const ASSET_CLASSES: AssetClass[] = ["equity", "debt", "gold", "cash", "other"];

/** Which capital-gains regime applies. Rates live in TaxConfig. */
export type TaxClass =
  | "equity" // listed equity shares, equity MFs / ETFs (STT paid, s.111A/112A)
  | "listedOther" // gold ETFs, listed bonds, other listed units
  | "unlistedOther" // physical gold, unlisted bonds
  | "slab" // debt MFs bought after 1-Apr-2023, interest income
  | "none"; // cash, commitments

export type EquitySegment =
  | "large"
  | "mid"
  | "small"
  | "flexi"
  | "multi"
  | "index"
  | "elss"
  | "sectoral"
  | "international"
  | "direct"
  | "other";

export const EQUITY_SEGMENTS: EquitySegment[] = [
  "large", "mid", "small", "flexi", "multi", "index", "elss", "sectoral", "international", "direct", "other",
];

export type EmergencyLayer = "instant" | "second" | "none";
export type PayoutFrequency = "monthly" | "quarterly" | "halfYearly" | "yearly" | "cumulative";

export interface SipPlan {
  amount: Paise;
  day: number; // 1–28
  start: ISODate;
  end?: ISODate;
}

export type InstrumentDetails =
  | { kind: "stock"; exchange: "NSE" | "BSE"; symbol: string; isin?: string }
  | { kind: "etf"; exchange: "NSE" | "BSE"; symbol: string; isin?: string }
  | { kind: "mf"; amfiCode: string; category?: string; sip?: SipPlan }
  | {
      kind: "rd";
      bank: string;
      monthlyAmount: Paise;
      ratePct: number;
      start: ISODate;
      tenureMonths: number;
      penaltyPct: number;
    }
  | {
      kind: "fd";
      bank: string;
      ratePct: number;
      start: ISODate;
      maturity: ISODate;
      payout: PayoutFrequency;
      penaltyPct: number;
      sweepIn: boolean;
    }
  | {
      kind: "bond";
      issuer: string;
      isin?: string;
      faceValue: number; // rupees per unit
      couponPct: number;
      payout: PayoutFrequency;
      maturity: ISODate;
      rating?: string;
      tdsPct: number;
      listed: boolean;
    }
  | { kind: "gold"; form: "etf" | "physical"; symbol?: string; exchange?: "NSE" | "BSE"; purity?: string }
  | { kind: "cash"; bank: string; account: "savings" | "current" | "sweep" | "wallet"; ratePct?: number }
  | { kind: "commitment"; beneficiary: string; monthlyAmount: Paise; day: number; start: ISODate; end?: ISODate };

export interface Instrument {
  id: string;
  name: string;
  kind: InstrumentKind;
  assetClass: AssetClass;
  taxClass: TaxClass;
  segment?: EquitySegment;
  sector?: string;
  /** Index or theme tracked, used to flag duplicate exposure (e.g. "NIFTY 50"). */
  trackingIndex?: string;
  emergencyLayer: EmergencyLayer;
  details: InstrumentDetails;
  archived?: boolean;
  sample?: boolean;
  createdAt: string;
}

export type TxnType =
  | "buy"
  | "sell"
  | "sip"
  | "bonus"
  | "split"
  | "deposit" // FD principal, cash deposit
  | "rd_instalment"
  | "withdrawal"
  | "interest" // interest credited/paid out
  | "coupon"
  | "dividend"
  | "redemption" // bond / fund redemption by issuer, by qty
  | "maturity" // FD/RD maturity proceeds (closes deposit)
  | "fee"
  | "commitment_payment"
  | "balance_adjust";

export interface Transaction {
  id: string;
  instrumentId: string;
  date: ISODate;
  type: TxnType;
  /** Units for market instruments; for "split", the ratio new/old (e.g. 5 for 1:5). */
  qty?: number;
  /** Price per unit in rupees. */
  price?: number;
  /** Gross amount in paise (qty × price for trades; cash amount otherwise). */
  amount: Paise;
  charges?: Paise;
  tds?: Paise;
  notes?: string;
  source: "manual" | "csv" | "sample" | "restore";
  importBatchId?: string;
  createdAt: string;
}

export interface PricePoint {
  instrumentId: string;
  date: ISODate;
  price: number; // rupees per unit
  prevClose?: number;
  /** "quote" is the pre-provider label kept for older backups. */
  source: "amfi" | "google" | "yahoo" | "quote" | "manual" | "derived" | "sample";
  fetchedAt: string; // ISO timestamp
}

export interface LookThroughHolding {
  name: string;
  sector?: string;
  weightPct: number;
}

export interface LookThrough {
  instrumentId: string;
  month: string; // YYYY-MM
  holdings: LookThroughHolding[];
}

export type PlanCategory = "sip" | "rd" | "commitment" | "buffer" | "other";

export interface PlanLine {
  id: string;
  category: PlanCategory;
  label: string;
  instrumentId?: string;
  planned: Paise;
}

export interface MonthlyPlan {
  month: string; // YYYY-MM
  lines: PlanLine[];
}

export type LoanKind = "home" | "car" | "bike" | "personal" | "education" | "gold" | "card" | "consumer" | "other";

export interface Liability {
  id: string;
  name: string;
  emi: Paise;
  emiDay: number;
  /** Date of the last EMI. */
  endDate: ISODate;
  kind?: LoanKind;
  /** Amount borrowed. With rate and start date it enables outstanding balance, interest and prepayment maths. */
  principal?: Paise;
  /** Annual interest rate in %, 0 for no-cost EMI. */
  ratePct?: number;
  /** Disbursal date; the first EMI falls one month later, on `emiDay`. */
  startDate?: ISODate;
  tenureMonths?: number;
  sample?: boolean;
}

export interface AllocationBand {
  assetClass: AssetClass;
  minPct: number;
  maxPct: number;
}

export interface TaxConfig {
  /** Label shown in UI so you know which budget the numbers follow. */
  label: string;
  equityStcgPct: number;
  equityLtcgPct: number;
  equityLtcgExemption: Paise;
  equityLtMonths: number;
  listedOtherLtcgPct: number;
  listedOtherLtMonths: number;
  unlistedOtherLtcgPct: number;
  unlistedOtherLtMonths: number;
  /** Your marginal slab rate incl. cess, used for slab-taxed gains and interest. */
  slabPct: number;
  /** Optional cess applied on top of capital-gains rates (4% health & education cess). */
  cessPct: number;
}

export interface Settings {
  id: "settings";
  monthlyExpenses: Paise;
  emergencyMonths: number;
  bands: AllocationBand[];
  minPositionSize: Paise;
  maxDirectStocks: number;
  maxStockPctOfEquity: number;
  maxSectorPctOfEquity: number;
  includeCommitments: boolean;
  /** Keep emergency-fund cash out of the allocation donut (it is not "investing" money). */
  excludeEmergencyFromAllocation: boolean;
  monthlyBudget: Paise;
  tax: TaxConfig;
  /** Preferred stock/ETF quote provider; the other one is the automatic fallback. */
  quoteSource: "google" | "yahoo";
  goldPerGramSource: "manual" | "etf";
  goldEtfInstrumentId?: string;
  goldGramsPerEtfUnit?: number;
  /** Expected in-hand salary, for the payday flow. */
  salary?: { amount: Paise; day: number; accountId?: string; employer?: string };
  /** Monthly spending budget per category id. */
  categoryBudgets: Record<string, Paise>;
  /** First name for greetings. */
  displayName?: string;
  /** Set once the welcome flow has been completed or skipped. */
  onboarded?: boolean;
  /** Monthly savings target. Unset = your SIP/RD/chit plans, else 20% of salary. */
  savingsGoal?: Paise;
  /** Milestones already celebrated (kept in settings so every device agrees and none repeats). */
  wins: { key: string; at: string }[];
  /** Confetti, toasts and haptics on savings milestones. */
  celebrations: boolean;
  lastBackupAt?: string;
  privacyMode: boolean;
  sampleLoaded?: boolean;
}

export const DEFAULT_TAX: TaxConfig = {
  label: "Budget 2024 (applies from 23-Jul-2024)",
  equityStcgPct: 20,
  equityLtcgPct: 12.5,
  equityLtcgExemption: 125_000_00,
  equityLtMonths: 12,
  listedOtherLtcgPct: 12.5,
  listedOtherLtMonths: 12,
  unlistedOtherLtcgPct: 12.5,
  unlistedOtherLtMonths: 24,
  slabPct: 31.2,
  cessPct: 4,
};

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  monthlyExpenses: 40_000_00,
  emergencyMonths: 6,
  bands: [
    { assetClass: "equity", minPct: 75, maxPct: 80 },
    { assetClass: "debt", minPct: 10, maxPct: 15 },
    { assetClass: "gold", minPct: 5, maxPct: 8 },
    { assetClass: "cash", minPct: 0, maxPct: 5 },
    { assetClass: "other", minPct: 0, maxPct: 5 },
  ],
  minPositionSize: 5_000_00,
  maxDirectStocks: 5,
  maxStockPctOfEquity: 5,
  maxSectorPctOfEquity: 35,
  includeCommitments: false,
  excludeEmergencyFromAllocation: true,
  monthlyBudget: 50_000_00,
  tax: DEFAULT_TAX,
  quoteSource: "google",
  categoryBudgets: {},
  wins: [],
  celebrations: true,
  goldPerGramSource: "manual",
  privacyMode: false,
};

/** Sensible defaults per kind; the add form lets you override. */
export function defaultsForKind(kind: InstrumentKind): Pick<Instrument, "assetClass" | "taxClass" | "emergencyLayer"> {
  switch (kind) {
    case "stock":
    case "etf":
    case "mf":
      return { assetClass: "equity", taxClass: "equity", emergencyLayer: "none" };
    case "rd":
    case "fd":
      return { assetClass: "debt", taxClass: "slab", emergencyLayer: "second" };
    case "bond":
      return { assetClass: "debt", taxClass: "listedOther", emergencyLayer: "second" };
    case "gold":
      return { assetClass: "gold", taxClass: "listedOther", emergencyLayer: "none" };
    case "cash":
      return { assetClass: "cash", taxClass: "none", emergencyLayer: "instant" };
    case "commitment":
      return { assetClass: "other", taxClass: "none", emergencyLayer: "none" };
  }
}

export const KIND_LABEL: Record<InstrumentKind, string> = {
  stock: "Stock",
  etf: "ETF",
  mf: "Mutual fund",
  rd: "Recurring deposit",
  fd: "Fixed deposit",
  bond: "Bond / NCD",
  gold: "Gold",
  cash: "Cash",
  commitment: "Commitment",
};

/** Instruments valued as qty × market price and tracked in FIFO lots. */
export function isMarketKind(kind: InstrumentKind): boolean {
  return kind === "stock" || kind === "etf" || kind === "mf" || kind === "gold" || kind === "bond";
}
