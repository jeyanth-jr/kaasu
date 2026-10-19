import { Suspense, lazy, useState } from "react";
import { Button, cx } from "../ui/components";
import { IconCloud, IconCloudOff } from "../ui/icons";
import { syncConfigured } from "./config";
import { useSyncState } from "./state";
const SyncSheet = lazy(() => import("./SyncPanel").then((m) => ({ default: m.SyncSheet })));

/** Cloud icon in the top bar: sign in, see sync status, manage the account. */
export function AccountButton() {
  const s = useSyncState();
  const [open, setOpen] = useState(false);
  if (!syncConfigured) return null;

  const dot =
    s.status === "error" ? "bg-loss" : s.status === "needs-decision" ? "bg-warn" : s.status === "syncing" ? "bg-warn animate-pulse" : s.status === "idle" ? "bg-gain" : s.status === "offline" ? "bg-faint" : "";
  const label =
    s.status === "signed-out" ? "Sign in to sync" : s.status === "syncing" ? "Syncing…" : s.status === "idle" ? "Synced" : s.status === "offline" ? "Offline" : s.status === "error" ? "Sync problem" : "Account";
  const Icon = s.status === "signed-out" || s.status === "offline" ? IconCloudOff : IconCloud;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={label} title={label} className="relative">
        <Icon size={17} />
        {dot && <span className={cx("absolute top-1 right-1 h-2 w-2 rounded-full ring-2 ring-paper", dot)} />}
        {s.status === "signed-out" && <span className="hidden text-xs sm:inline">Sign in</span>}
      </Button>
      {(open || s.status === "needs-decision") && (
        <Suspense fallback={null}>
          <SyncSheet onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
