import { useSyncExternalStore } from "react";
import { COLLECTIONS, keyToId, tableOf, type Collection } from "../sync/collections";
import { isRemote } from "../sync/track";
import { db } from "./db";

/**
 * Undo for every kind of change. Instead of each screen writing its own "reverse" logic, the tables are
 * hooked: while an action runs inside `withUndo`, the first stored version of every record it touches
 * (or the fact that it didn't exist) is remembered, and undoing puts those versions back. That covers
 * money entries, investment transactions, transfers, account edits, goals and settings alike, and the
 * restoring writes flow into the sync outbox like any other edit.
 */

interface Saved {
  table: Collection;
  key: unknown;
  /** The record as it was before the action, or undefined if the action created it. */
  before: unknown;
}

export interface UndoItem {
  id: number;
  label: string;
  at: number;
  saved: Saved[];
}

const MAX_STACK = 25;
let scope: Map<string, Saved> | null = null;
let stack: UndoItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function remember(table: Collection, key: unknown, before: unknown) {
  if (!scope) return;
  const k = `${table}|${keyToId(key)}`;
  // Keep the earliest version: a record changed twice in one action must return to how it started.
  if (!scope.has(k)) scope.set(k, { table, key, before: clone(before) });
}

let installed = false;
export function installUndoTracking(): void {
  if (installed) return;
  installed = true;
  for (const c of COLLECTIONS) {
    const table = tableOf(db, c);
    table.hook("creating", function (primKey, _obj, trans) {
      if (scope && !isRemote(trans)) {
        // For tables whose key is a field of the object the key is known here; otherwise it is learned on success.
        if (primKey !== undefined) remember(c, primKey, undefined);
        else this.onsuccess = (pk) => remember(c, pk, undefined);
      }
    });
    table.hook("updating", function (_mods, primKey, obj, trans) {
      if (scope && !isRemote(trans)) remember(c, primKey, obj);
    });
    table.hook("deleting", function (primKey, obj, trans) {
      if (scope && !isRemote(trans)) remember(c, primKey, obj);
    });
  }
}

/** Run a change so it can be undone. Nested calls join the outer action. */
export async function withUndo<T>(label: string, fn: () => Promise<T>): Promise<T> {
  installUndoTracking();
  if (scope) return fn();
  scope = new Map();
  const mine = scope;
  try {
    return await fn();
  } finally {
    scope = null;
    if (mine.size > 0) {
      stack = [...stack, { id: nextId++, label, at: Date.now(), saved: [...mine.values()] }].slice(-MAX_STACK);
      emit();
    }
  }
}

/** Reverse the most recent change. Returns its label, or null if there is nothing to undo. */
export async function undoLast(): Promise<string | null> {
  const item = stack.at(-1);
  if (!item) return null;
  stack = stack.slice(0, -1);
  emit();
  const tables = COLLECTIONS.map((c) => tableOf(db, c));
  await db.transaction("rw", tables, async () => {
    for (const s of [...item.saved].reverse()) {
      const t = tableOf(db, s.table);
      if (s.before === undefined) await t.delete(s.key);
      else await t.put(clone(s.before));
    }
  });
  return item.label;
}

export function clearUndo(): void {
  stack = [];
  emit();
}

const subscribe = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb));
const snapshot = () => stack;

/** The undo stack, newest last. */
export function useUndoStack(): UndoItem[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
