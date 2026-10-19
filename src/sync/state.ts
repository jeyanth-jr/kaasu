import { useSyncExternalStore } from "react";

export type SyncStatus = "unconfigured" | "signed-out" | "idle" | "syncing" | "error" | "offline" | "needs-decision";

export interface SyncState {
  status: SyncStatus;
  email?: string;
  userId?: string;
  lastSyncedAt?: string;
  /** Local changes not yet uploaded. */
  pending: number;
  error?: string;
}

let state: SyncState = { status: "unconfigured", pending: 0 };
const listeners = new Set<() => void>();

export function getSyncState(): SyncState {
  return state;
}

export function setSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getSyncState, getSyncState);
}

/** True while this device is signed in and syncing (so local-only backup nags can stay quiet). */
export function useSyncActive(): boolean {
  const s = useSyncState();
  return s.status === "idle" || s.status === "syncing" || s.status === "offline" || (s.status === "error" && !!s.userId);
}
