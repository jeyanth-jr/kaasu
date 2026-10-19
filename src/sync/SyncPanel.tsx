import { useState, type ReactNode } from "react";
import { formatDate } from "../domain/dates";
import { Badge, Button, Callout, Field, Input, Sheet } from "../ui/components";
import { IconCloud, IconMail, IconShield } from "../ui/icons";
import { deleteAccount, deleteCloudData, resolveDifferentAccount, sendEmailLink, signInWithGoogle, signOut, syncNow, verifyEmailCode } from "./controller";
import { useSyncState } from "./state";

export function SyncSheet({ onClose }: { onClose: () => void }) {
  const s = useSyncState();
  const decision = s.status === "needs-decision";
  return (
    <Sheet open onClose={decision ? () => undefined : onClose} title={decision ? "Different account" : s.userId ? "Your account" : "Sign in to sync"}>
      <SyncPanel />
    </Sheet>
  );
}

/** Sign-in form, or the signed-in account view. Used in the sheet and in Settings. */
export function SyncPanel() {
  const s = useSyncState();
  if (s.status === "needs-decision") return <DifferentAccount email={s.email} />;
  if (s.userId) return <SignedIn />;
  return <SignInForm />;
}

export function SignInForm({ intro, hidePrivacy }: { intro?: ReactNode; hidePrivacy?: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{intro ?? "Enter your email and we'll send a sign-in link. No password needed. If you're new, this creates your account."}</p>
      {error && <Callout tone="warn">{error}</Callout>}
      {!sent ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await sendEmailLink(email);
              setSent(true);
            });
          }}
        >
          <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}</Field>
          <Button variant="primary" type="submit" disabled={busy || !email.includes("@")}>
            <IconMail size={16} /> {busy ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verifyEmailCode(email, code));
          }}
        >
          <Callout tone="accent" title="Check your inbox">
            We sent a link to <b>{email}</b>. Open it on this device, or type the 6-digit code from the email below.
          </Callout>
          <Field label="6-digit code (optional)">{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="tracking-[0.4em]" />}</Field>
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Sign in"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSent(false)}>
              Use another email
            </Button>
          </div>
        </form>
      )}
      <div className="flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <Button onClick={() => void run(signInWithGoogle)} disabled={busy}>
        Continue with Google
      </Button>
      {!hidePrivacy && <PrivacyNote />}
    </div>
  );
}

function SignedIn() {
  const s = useSyncState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [danger, setDanger] = useState(false);

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status =
    s.status === "syncing" ? <Badge tone="warn">Syncing…</Badge> : s.status === "offline" ? <Badge>Offline</Badge> : s.status === "error" ? <Badge tone="loss">Problem</Badge> : <Badge tone="gain">Synced</Badge>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl bg-sunken px-4 py-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
          <IconCloud size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{s.email ?? "Signed in"}</div>
          <div className="text-xs text-muted">
            {s.lastSyncedAt ? `Last synced ${formatDate(s.lastSyncedAt.slice(0, 10))} ${new Date(s.lastSyncedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Not synced yet"}
            {s.pending > 0 && ` · ${s.pending} change${s.pending === 1 ? "" : "s"} waiting`}
          </div>
        </div>
        {status}
      </div>
      {s.error && <Callout tone="warn">{s.error}</Callout>}
      {msg && <Callout tone="neutral">{msg}</Callout>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void run(syncNow)} disabled={busy || s.status === "syncing"}>
          Sync now
        </Button>
        <Button onClick={() => void run(() => signOut({ removeLocal: false }))} disabled={busy}>
          Sign out
        </Button>
      </div>
      <p className="text-xs text-muted">
        Sign out keeps your data on this device. To remove it from a shared or borrowed device instead,{" "}
        <button
          className="font-semibold text-ink underline underline-offset-2"
          onClick={() => {
            if (confirm("Sign out and remove all Kaasu data from this device? Your cloud copy stays and returns when you sign in again.")) void run(() => signOut({ removeLocal: true }));
          }}
        >
          sign out and clear this device
        </button>
        .
      </p>
      <PrivacyNote />
      <div className="border-t border-line pt-3">
        <button className="text-xs font-semibold text-faint hover:text-ink" onClick={() => setDanger((d) => !d)}>
          {danger ? "Hide" : "Show"} danger zone
        </button>
        {danger && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (confirm("Erase your cloud copy and disconnect this device? Data stays on your devices.")) void run(deleteCloudData, "Cloud copy erased.");
                }}
              >
                Erase cloud copy
              </Button>
              <p className="mt-1 text-xs text-muted">Removes everything stored in the cloud. This and your other devices keep their local data.</p>
            </div>
            <div>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (confirm("Permanently delete your account and all cloud data? This can't be undone.")) void run(deleteAccount, "Account deleted.");
                }}
              >
                Delete account
              </Button>
              <p className="mt-1 text-xs text-muted">Deletes your login and every cloud record. Local data on this device is not touched.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DifferentAccount({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="warn" title="This device holds another account's data">
        Kaasu on this device was synced with a different account. To use <b>{email}</b> here, that data has to be removed from this device first. It stays safe in the other account's cloud copy.
      </Callout>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await resolveDifferentAccount("replace");
          }}
        >
          Remove it and continue
        </Button>
        <Button disabled={busy} onClick={() => void resolveDifferentAccount("cancel")}>
          Cancel and sign out
        </Button>
      </div>
      <p className="text-xs text-muted">Want to keep the old data? Cancel, then sign back in with the original account and download a backup from Settings first.</p>
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="flex gap-2.5 rounded-2xl border border-line p-3 text-xs text-muted">
      <IconShield size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>
        Your data is stored in your private account, encrypted in transit and at rest, and only your login can read it. It is not end-to-end encrypted, so the service operator can technically access it. See the Privacy page for details.
      </span>
    </div>
  );
}
