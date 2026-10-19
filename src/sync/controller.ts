import type { Session } from "@supabase/supabase-js";
import { db } from "../db/db";
import { setTokenProvider } from "../prices/api";
import { syncConfigured } from "./config";
import { claimDevice, getMeta, syncOnce, wipeLocal } from "./engine";
import { setDemo } from "./demo";
import { getSyncState, setSyncState } from "./state";
import { supabase, supabaseRemote } from "./supabase";
import { installTracking } from "./track";

/**
 * Wires the engine to the app: who is signed in, when to sync, and what to do
 * when someone signs in on a device that holds another account's data.
 */

let started = false;
let running = false;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let session: Session | null = null;
let paused = false; // waiting for the "different account" decision

const DEBOUNCE_MS = 2500;
const POLL_MS = 60_000;

async function refreshPending(): Promise<void> {
  setSyncState({ pending: await db.outbox.count() });
}

export function scheduleSync(): void {
  void refreshPending();
  if (!session || paused) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), DEBOUNCE_MS);
}

export async function syncNow(): Promise<void> {
  if (!supabase || !session || paused) return;
  if (running) {
    rerun = true;
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setSyncState({ status: "offline" });
    return;
  }
  running = true;
  setSyncState({ status: "syncing", error: undefined });
  try {
    await syncOnce(db, supabaseRemote(supabase, session.user.id));
    const meta = await getMeta(db);
    setSyncState({ status: "idle", lastSyncedAt: meta.lastSyncedAt, error: undefined });
  } catch (e) {
    const msg = (e as Error).message;
    setSyncState({ status: navigator.onLine === false ? "offline" : "error", error: /fetch|network|load failed/i.test(msg) ? "Can't reach the cloud. Will retry." : msg });
  } finally {
    running = false;
    await refreshPending();
    if (rerun) {
      rerun = false;
      scheduleSync();
    }
  }
}

async function onSession(next: Session | null): Promise<void> {
  session = next;
  if (!next) {
    paused = false;
    setSyncState({ status: "signed-out", email: undefined, userId: undefined, error: undefined });
    return;
  }
  setDemo(false); // a real account replaces demo mode
  setSyncState({ email: next.user.email ?? undefined, userId: next.user.id });
  const claim = await claimDevice(db, next.user.id);
  if (claim === "different") {
    paused = true;
    setSyncState({ status: "needs-decision" });
    return;
  }
  paused = false;
  await syncNow();
}

export function initSync(): void {
  if (started || !syncConfigured || !supabase) return;
  started = true;
  const client = supabase;
  installTracking(db, scheduleSync);
  setTokenProvider(async () => (await client.auth.getSession()).data.session?.access_token ?? null);
  // If the auth library never reports (blocked storage, network), don't leave the user on a splash screen.
  setTimeout(() => {
    if (getSyncState().status === "loading") setSyncState({ status: "signed-out" });
  }, 5000);

  client.auth.onAuthStateChange((event, s) => {
    // INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT / USER_UPDATED
    if (event === "TOKEN_REFRESHED" && session && s) {
      session = s; // keep the token fresh without re-claiming the device
      return;
    }
    // Defer: calling Supabase inside this callback can deadlock.
    setTimeout(() => void onSession(s), 0);
  });

  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => session && setSyncState({ status: "offline" }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, POLL_MS);
  void refreshPending();
}

// ---------------------------------------------------------------------------
// Account actions

function need() {
  if (!supabase) throw new Error("Cloud sync isn't set up for this deployment.");
  return supabase;
}

/** Email sign-in: sends a link (and a 6-digit code if the email template includes it). */
export async function sendEmailLink(email: string, captchaToken?: string): Promise<void> {
  const { error } = await need().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${location.origin}${location.pathname}`, captchaToken } });
  if (error) throw new Error(error.message);
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await need().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await need().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}${location.pathname}` } });
  if (error) throw new Error(/not enabled|unsupported provider/i.test(error.message) ? "Google sign-in isn't switched on for this site yet." : error.message);
}

/** Resolve the "this device holds another account's data" prompt. */
export async function resolveDifferentAccount(choice: "replace" | "cancel"): Promise<void> {
  if (choice === "cancel") {
    await signOut({ removeLocal: false });
    return;
  }
  if (!session) return;
  await wipeLocal(db, session.user.id);
  paused = false;
  await syncNow();
}

export async function signOut(opts: { removeLocal: boolean }): Promise<void> {
  const client = need();
  if (opts.removeLocal && session && !paused) await syncNow(); // upload anything pending first
  paused = false;
  await client.auth.signOut();
  if (opts.removeLocal) await wipeLocal(db);
  session = null;
  setSyncState({ status: "signed-out", email: undefined, userId: undefined, pending: await db.outbox.count() });
}

/**
 * Erase this account's cloud copy and disconnect this device. Local data stays;
 * other devices keep theirs too. Signing in again later re-uploads from scratch.
 */
export async function deleteCloudData(): Promise<void> {
  const client = need();
  if (!session) throw new Error("Sign in first.");
  const { error } = await client.from("records").delete().eq("user_id", session.user.id);
  if (error) throw new Error(error.message);
  await disconnectDevice();
}

async function disconnectDevice(): Promise<void> {
  await db.transaction("rw", db.outbox, db.syncMeta, async () => {
    await db.outbox.clear();
    await db.syncMeta.put({ id: "meta", cursor: 0 }); // no owner: next sign-in adopts local data afresh
  });
  paused = false;
  await need().auth.signOut();
  session = null;
  setSyncState({ status: "signed-out", email: undefined, userId: undefined, pending: 0 });
}

/** Permanently delete the login and every cloud record. Local data on this device stays. */
export async function deleteAccount(): Promise<void> {
  const client = need();
  const { error } = await client.rpc("delete_my_account");
  if (error) throw new Error(error.message);
  await disconnectDevice();
}

export function currentSyncStatus() {
  return getSyncState().status;
}
