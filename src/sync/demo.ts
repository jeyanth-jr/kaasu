import { useSyncExternalStore } from "react";

/**
 * Demo mode: explore the app with fictional sample data, without an account.
 * Sample data never syncs, so a demo can't touch anyone's cloud copy.
 */
const KEY = "kaasu.demo";
const listeners = new Set<() => void>();

export function isDemo(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemo(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: demo lasts for this tab only */
  }
  for (const l of listeners) l();
}

export async function startDemo(): Promise<void> {
  const { loadSampleData } = await import("../db/sample");
  await loadSampleData();
  setDemo(true);
}

export async function endDemo(): Promise<void> {
  const { clearSampleData } = await import("../db/sample");
  await clearSampleData();
  setDemo(false);
}

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export function useDemo(): boolean {
  return useSyncExternalStore(subscribe, isDemo, () => false);
}
