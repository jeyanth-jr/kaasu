import { z } from "zod";
import { db, mergeSettings, nowISO } from "./db";

/**
 * Full JSON backup. The format is versioned and validated on restore so a
 * truncated or hand-edited file is rejected with a reason rather than half-applied.
 */
export const BACKUP_FORMAT = "kaasu-backup";
export const BACKUP_VERSION = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paise = z.number().int();

const instrument = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    kind: z.enum(["stock", "etf", "mf", "rd", "fd", "bond", "gold", "cash", "commitment"]),
    assetClass: z.enum(["equity", "debt", "gold", "cash", "other"]),
    taxClass: z.enum(["equity", "listedOther", "unlistedOther", "slab", "none"]),
    emergencyLayer: z.enum(["instant", "second", "none"]),
    details: z.object({ kind: z.string() }).passthrough(),
    createdAt: z.string(),
  })
  .passthrough();

const txn = z
  .object({
    id: z.string().min(1),
    instrumentId: z.string().min(1),
    date: isoDate,
    type: z.string(),
    amount: paise,
    qty: z.number().optional(),
    price: z.number().optional(),
    charges: paise.optional(),
    tds: paise.optional(),
    source: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

const price = z
  .object({ instrumentId: z.string(), date: isoDate, price: z.number().positive(), source: z.string(), fetchedAt: z.string() })
  .passthrough();

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().max(BACKUP_VERSION),
  exportedAt: z.string(),
  data: z.object({
    instruments: z.array(instrument),
    txns: z.array(txn),
    prices: z.array(price).default([]),
    lookThrough: z.array(z.object({ instrumentId: z.string(), month: z.string(), holdings: z.array(z.any()) }).passthrough()).default([]),
    plans: z.array(z.object({ month: z.string(), lines: z.array(z.any()) }).passthrough()).default([]),
    liabilities: z.array(z.object({ id: z.string() }).passthrough()).default([]),
    cash: z
      .array(z.object({ id: z.string().min(1), date: isoDate, kind: z.enum(["income", "expense"]), amount: paise.nonnegative(), category: z.string() }).passthrough())
      .default([]),
    paydays: z.array(z.object({ month: z.string(), done: z.record(z.boolean()) }).passthrough()).default([]),
    goals: z.array(z.object({ id: z.string().min(1), name: z.string(), target: paise }).passthrough()).default([]),
    goalFunds: z.array(z.object({ id: z.string().min(1), goalId: z.string(), date: isoDate, amount: paise }).passthrough()).default([]),
    settings: z.object({}).passthrough().optional(),
  }),
});

export type Backup = z.infer<typeof backupSchema>;

export async function createBackup(): Promise<Backup> {
  const [instruments, txns, prices, lookThrough, plans, liabilities, cash, paydays, goals, goalFunds, settings] = await Promise.all([
    db.instruments.toArray(),
    db.txns.toArray(),
    db.prices.toArray(),
    db.lookThrough.toArray(),
    db.plans.toArray(),
    db.liabilities.toArray(),
    db.cash.toArray(),
    db.paydays.toArray(),
    db.goals.toArray(),
    db.goalFunds.toArray(),
    db.settings.get("settings"),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    data: { instruments, txns, prices, lookThrough, plans, liabilities, cash, paydays, goals, goalFunds, settings: settings ?? undefined },
  } as unknown as Backup;
}

export function backupFileName(d = new Date()): string {
  const stamp = d.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `kaasu-backup-${stamp}.json`;
}

export type RestoreResult =
  | { ok: true; counts: Record<string, number> }
  | { ok: false; error: string };

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  const r = backupSchema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `Not a Kaasu backup (${issue?.path.join(".") || "root"}: ${issue?.message}).` };
  }
  const ids = new Set(r.data.data.instruments.map((i) => i.id));
  const orphan = r.data.data.txns.find((t) => !ids.has(t.instrumentId));
  if (orphan) return { ok: false, error: `Transaction ${orphan.id} points to a missing instrument.` };
  return { ok: true, backup: r.data };
}

/** Replace everything with the backup, atomically. */
export async function restoreBackup(backup: Backup): Promise<RestoreResult> {
  const d = backup.data;
  try {
    await db.transaction("rw", [db.instruments, db.txns, db.prices, db.lookThrough, db.plans, db.liabilities, db.settings, db.imports, db.cash, db.paydays, db.goals, db.goalFunds], async () => {
      await Promise.all([
        db.instruments.clear(),
        db.txns.clear(),
        db.prices.clear(),
        db.lookThrough.clear(),
        db.plans.clear(),
        db.liabilities.clear(),
        db.imports.clear(),
        db.cash.clear(),
        db.paydays.clear(),
        db.goals.clear(),
        db.goalFunds.clear(),
      ]);
      await db.instruments.bulkPut(d.instruments as never[]);
      await db.txns.bulkPut(d.txns as never[]);
      await db.prices.bulkPut(d.prices as never[]);
      await db.lookThrough.bulkPut(d.lookThrough as never[]);
      await db.plans.bulkPut(d.plans as never[]);
      await db.liabilities.bulkPut(d.liabilities as never[]);
      await db.cash.bulkPut(d.cash as never[]);
      await db.paydays.bulkPut(d.paydays as never[]);
      await db.goals.bulkPut(d.goals as never[]);
      await db.goalFunds.bulkPut(d.goalFunds as never[]);
      await db.settings.put(mergeSettings(d.settings as never));
    });
  } catch (e) {
    return { ok: false, error: `Restore failed and nothing was changed: ${(e as Error).message}` };
  }
  return {
    ok: true,
    counts: {
      instruments: d.instruments.length,
      transactions: d.txns.length,
      prices: d.prices.length,
      cash: d.cash.length,
    },
  };
}

export async function clearAll(): Promise<void> {
  await db.transaction("rw", [db.instruments, db.txns, db.prices, db.lookThrough, db.plans, db.liabilities, db.imports, db.cash, db.paydays, db.goals, db.goalFunds], async () => {
    await Promise.all([
      db.cash.clear(),
      db.paydays.clear(),
      db.goals.clear(),
      db.goalFunds.clear(),
      db.instruments.clear(),
      db.txns.clear(),
      db.prices.clear(),
      db.lookThrough.clear(),
      db.plans.clear(),
      db.liabilities.clear(),
      db.imports.clear(),
    ]);
  });
}
