import Dexie, { type Table } from "dexie";
import type {
  Instrument,
  Liability,
  LookThrough,
  MonthlyPlan,
  PricePoint,
  Settings,
  Transaction,
} from "../domain/types";
import { DEFAULT_SETTINGS } from "../domain/types";

export interface ImportBatch {
  id: string;
  createdAt: string;
  source: "csv";
  fileName: string;
  rows: number;
}

export class KaasuDB extends Dexie {
  instruments!: Table<Instrument, string>;
  txns!: Table<Transaction, string>;
  prices!: Table<PricePoint, [string, string]>;
  lookThrough!: Table<LookThrough, [string, string]>;
  plans!: Table<MonthlyPlan, string>;
  liabilities!: Table<Liability, string>;
  settings!: Table<Settings, string>;
  imports!: Table<ImportBatch, string>;

  constructor(name = "kaasu") {
    super(name);
    this.version(1).stores({
      instruments: "id, kind, assetClass, archived",
      txns: "id, instrumentId, date, type, importBatchId, [instrumentId+date]",
      prices: "[instrumentId+date], instrumentId, date",
      lookThrough: "[instrumentId+month], instrumentId",
      plans: "month",
      liabilities: "id",
      settings: "id",
      imports: "id, createdAt",
    });
  }
}

export const db = new KaasuDB();

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get("settings");
  return mergeSettings(s);
}

/** Fill fields added in later versions so old backups and DBs keep working. */
export function mergeSettings(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    tax: { ...DEFAULT_SETTINGS.tax, ...(s?.tax ?? {}) },
    bands: s?.bands && s.bands.length > 0 ? s.bands : DEFAULT_SETTINGS.bands,
    id: "settings",
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: "settings" });
}

export function newId(prefix = ""): string {
  const r = crypto.getRandomValues(new Uint8Array(10));
  return prefix + Array.from(r, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* unsupported */
  }
  return null;
}
