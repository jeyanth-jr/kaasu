import type { KaasuDB, OutboxEntry } from "../db/db";
import { COLLECTIONS, idToKey, isCollection, isSampleRecord, keyToId, tableOf, type Collection } from "./collections";
import { markRemote } from "./track";

/**
 * Sync engine: pushes local changes, then pulls everyone else's.
 *
 * - Last write wins per record (a single person's devices rarely collide).
 * - A record with a local change still waiting to push is never overwritten by
 *   a pull; the local version is pushed and wins.
 * - Deletions travel as tombstones.
 * - The cursor is a server-assigned sequence number, not a clock.
 */

export interface RemoteWrite {
  collection: string;
  id: string;
  data: unknown | null;
  deleted: boolean;
}
export interface RemoteRow extends RemoteWrite {
  seq: number;
}
export interface RemoteStore {
  push(rows: RemoteWrite[]): Promise<void>;
  /** Rows with seq > afterSeq for the signed-in user, oldest first. */
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  applied: number;
}

const PUSH_BATCH = 500;
const PULL_PAGE = 1000;

export async function getMeta(db: KaasuDB) {
  return (await db.syncMeta.get("meta")) ?? { id: "meta" as const, cursor: 0 };
}

/** Current state of each queued record: its data, or a tombstone if it no longer exists. Sample rows are dropped. */
async function readEntries(db: KaasuDB, entries: OutboxEntry[]): Promise<RemoteWrite[]> {
  const writes: RemoteWrite[] = [];
  for (const e of entries) {
    if (!isCollection(e.collection)) continue;
    const rec = await tableOf(db, e.collection).get(idToKey(e.collection, e.id));
    if (rec && isSampleRecord(e.collection, rec)) continue;
    writes.push(rec ? { collection: e.collection, id: e.id, data: rec, deleted: false } : { collection: e.collection, id: e.id, data: null, deleted: true });
  }
  return writes;
}

async function pushAll(db: KaasuDB, remote: RemoteStore): Promise<number> {
  let pushed = 0;
  for (;;) {
    const entries = await db.outbox.limit(PUSH_BATCH).toArray();
    if (entries.length === 0) return pushed;
    const writes = await readEntries(db, entries);
    if (writes.length) await remote.push(writes);
    pushed += writes.length;
    // Clear only entries untouched while the push was in flight; edited ones go round again.
    await db.transaction("rw", db.outbox, async () => {
      for (const e of entries) {
        const cur = await db.outbox.get(e.key);
        if (cur && cur.v === e.v) await db.outbox.delete(e.key);
      }
    });
  }
}

async function pullAll(db: KaasuDB, remote: RemoteStore): Promise<{ pulled: number; applied: number }> {
  let pulled = 0;
  let applied = 0;
  for (;;) {
    const meta = await getMeta(db);
    const rows = await remote.pull(meta.cursor, PULL_PAGE);
    if (rows.length === 0) return { pulled, applied };
    const tables = COLLECTIONS.map((c) => tableOf(db, c));
    await db.transaction("rw", [...tables, db.outbox, db.syncMeta], async (tx) => {
      markRemote(tx);
      const pending = new Set((await db.outbox.toArray()).map((o) => o.key));
      for (const r of rows) {
        if (!isCollection(r.collection)) continue; // written by a newer app version
        if (pending.has(`${r.collection}|${r.id}`)) continue; // local change wins
        const table = tableOf(db, r.collection as Collection);
        const key = idToKey(r.collection as Collection, r.id);
        if (r.deleted) {
          if ((await table.get(key)) !== undefined) {
            await table.delete(key);
            applied++;
          }
        } else {
          const cur = await table.get(key);
          if (cur === undefined || JSON.stringify(cur) !== JSON.stringify(r.data)) {
            await table.put(r.data as object);
            applied++;
          }
        }
      }
      const last = rows[rows.length - 1]!.seq;
      const m = await getMeta(db);
      await db.syncMeta.put({ ...m, cursor: Math.max(m.cursor, last) });
    });
    pulled += rows.length;
  }
}

export async function syncOnce(db: KaasuDB, remote: RemoteStore): Promise<SyncResult> {
  const pushed = await pushAll(db, remote);
  const { pulled, applied } = await pullAll(db, remote);
  const m = await getMeta(db);
  await db.syncMeta.put({ ...m, lastSyncedAt: new Date().toISOString() });
  return { pushed, pulled, applied };
}

// ---------------------------------------------------------------------------
// Which account owns this device's data

export type Adoption = "adopted" | "same" | "different";

/**
 * Called after sign-in. First time on this device: the existing local data
 * becomes this account's (queued for upload). Same account: nothing to do.
 * A different account: caller must confirm before local data is replaced.
 */
export async function claimDevice(db: KaasuDB, userId: string): Promise<Adoption> {
  const m = await getMeta(db);
  if (m.userId === userId) return "same";
  if (m.userId) return "different";
  await db.syncMeta.put({ ...m, userId, cursor: 0 });
  await seedOutbox(db);
  return "adopted";
}

/** Queue every non-sample local record for upload (first connect). */
export async function seedOutbox(db: KaasuDB): Promise<number> {
  let n = 0;
  for (const c of COLLECTIONS) {
    const table = tableOf(db, c);
    const entries: OutboxEntry[] = [];
    await table.each((rec: Record<string, unknown>, cursor: { primaryKey: unknown }) => {
      if (isSampleRecord(c, rec)) return;
      const id = keyToId(cursor.primaryKey);
      entries.push({ key: `${c}|${id}`, collection: c, id, v: `seed.${entries.length}` });
    });
    if (entries.length) await db.outbox.bulkPut(entries);
    n += entries.length;
  }
  return n;
}

/** Remove everything synced from this device, leaving it empty and unowned. */
export async function wipeLocal(db: KaasuDB, newOwner?: string): Promise<void> {
  const tables = COLLECTIONS.map((c) => tableOf(db, c));
  await db.transaction("rw", [...tables, db.outbox, db.syncMeta], async (tx) => {
    markRemote(tx); // don't queue these deletions for upload
    for (const t of tables) await t.clear();
    await db.outbox.clear();
    await db.syncMeta.put({ id: "meta", cursor: 0, userId: newOwner });
  });
}
