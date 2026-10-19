import Dexie from "dexie";
import type { KaasuDB } from "../db/db";
import { COLLECTIONS, isSampleRecord, keyToId, tableOf, type Collection } from "./collections";

/** Marks a transaction as "applying remote changes" so those writes aren't echoed back. */
const REMOTE = "__kaasuRemote";
export function markRemote(tx: unknown): void {
  (tx as Record<string, unknown>)[REMOTE] = true;
}
export const isRemote = (tx: unknown) => !!tx && (tx as Record<string, unknown>)[REMOTE] === true;

let counter = 0;
const nonce = () => `${Date.now().toString(36)}.${(counter++).toString(36)}`;

export interface Tracker {
  /** Stop recording changes (and remove nothing: hooks are cheap and idempotent). */
  setEnabled(on: boolean): void;
}

/**
 * Records every local create/update/delete in the outbox by hooking the
 * tables, so no screen or import has to remember to "mark dirty". Works for
 * bulk operations, clear(), and explicit transactions that don't include the
 * outbox (the outbox write happens after the change commits, in its own
 * transaction).
 */
export function installTracking(db: KaasuDB, onChange?: () => void): Tracker {
  let enabled = true;

  const enqueue = (collection: Collection, key: unknown) => {
    const id = keyToId(key);
    Dexie.ignoreTransaction(() => {
      void db.outbox
        .put({ key: `${collection}|${id}`, collection, id, v: nonce() })
        .then(() => onChange?.())
        .catch(() => undefined);
    });
  };

  for (const c of COLLECTIONS) {
    const table = tableOf(db, c);
    table.hook("creating", function (primKey, obj, trans) {
      if (!enabled || isRemote(trans) || isSampleRecord(c, obj)) return;
      this.onsuccess = (pk) => enqueue(c, pk ?? primKey);
    });
    table.hook("updating", function (_mods, primKey, obj, trans) {
      if (!enabled || isRemote(trans) || isSampleRecord(c, obj)) return;
      this.onsuccess = () => enqueue(c, primKey);
    });
    table.hook("deleting", function (primKey, obj, trans) {
      if (!enabled || isRemote(trans) || isSampleRecord(c, obj)) return;
      this.onsuccess = () => enqueue(c, primKey);
    });
  }

  return { setEnabled: (on) => void (enabled = on) };
}
