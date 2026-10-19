import Dexie, { type Table } from "dexie";
import type { CashEntry } from "../domain/cashflow";
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
  /** Instruments this import created; undo removes them if they end up empty. */
  instrumentIds?: string[];
}

/** Undo a CSV import: delete its transactions and any instruments it created that are now empty. */
export async function undoImport(batchId: string): Promise<number> {
  return db.transaction("rw", [db.txns, db.instruments, db.prices, db.imports], async () => {
    const n = await db.txns.where("importBatchId").equals(batchId).delete();
    const batch = await db.imports.get(batchId);
    for (const id of batch?.instrumentIds ?? []) {
      if ((await db.txns.where("instrumentId").equals(id).count()) === 0) {
        await db.prices.where("instrumentId").equals(id).delete();
        await db.instruments.delete(id);
      }
    }
    await db.imports.delete(batchId);
    return n;
  });
}

/** A local change waiting to be pushed to the cloud. Keyed so repeated edits coalesce. */
export interface OutboxEntry {
  key: string; // `${collection}|${id}`
  collection: string;
  id: string;
  /** Changes on every enqueue, so a push can tell whether the record moved while it was in flight. */
  v: string;
}

export interface SyncMeta {
  id: "meta";
  /** The cloud account this device's data belongs to. */
  userId?: string;
  /** Highest server sequence number applied locally. */
  cursor: number;
  lastSyncedAt?: string;
}

/** One per month once salary arrives: the payday checklist state. */
export interface PaydayRecord {
  month: string; // YYYY-MM
  salaryEntryId?: string;
  done: Record<string, boolean>;
  updatedAt: string;
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
  cash!: Table<CashEntry, string>;
  paydays!: Table<PaydayRecord, string>;
  outbox!: Table<OutboxEntry, string>;
  syncMeta!: Table<SyncMeta, string>;

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
    // v2: day-to-day money (income, spending, payday checklist).
    this.version(2).stores({
      cash: "id, date, kind, category, accountId, importBatchId, fingerprint",
      paydays: "month",
    });
    // v3: cloud sync bookkeeping (local only; never synced or backed up).
    this.version(3).stores({
      outbox: "key",
      syncMeta: "id",
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
    categoryBudgets: { ...(s?.categoryBudgets ?? {}) },
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
