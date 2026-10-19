import type { Table } from "dexie";
import type { KaasuDB } from "../db/db";

/** Tables that sync to the cloud, and how each record is identified there. */
export const COLLECTIONS = ["instruments", "txns", "prices", "lookThrough", "plans", "liabilities", "settings", "imports", "cash", "paydays"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export function isCollection(s: string): s is Collection {
  return (COLLECTIONS as readonly string[]).includes(s);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(db: KaasuDB, c: Collection): Table<any, any> {
  return db[c] as Table<any, any>;
}

/** Composite keys (price per day, look-through per month) are joined with "|". */
export function keyToId(key: unknown): string {
  return Array.isArray(key) ? key.join("|") : String(key);
}

export function idToKey(c: Collection, id: string): string | [string, string] {
  if (c === "prices" || c === "lookThrough") {
    const i = id.lastIndexOf("|");
    return [id.slice(0, i), id.slice(i + 1)];
  }
  return id;
}

/**
 * Sample data is demo-only and never leaves the device, so loading or clearing
 * it can't touch (or pollute) a real cloud account.
 */
export function isSampleRecord(c: Collection, rec: Record<string, unknown> | undefined | null): boolean {
  if (!rec) return false;
  switch (c) {
    case "instruments":
    case "liabilities":
      return rec.sample === true;
    case "txns":
    case "cash":
    case "prices":
      return rec.source === "sample";
    case "lookThrough":
      return typeof rec.instrumentId === "string" && rec.instrumentId.startsWith("sample-");
    default:
      return false;
  }
}
