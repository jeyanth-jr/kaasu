import { useEffect, useMemo } from "react";
import { applyAutoPosts } from "../db/autopost";
import { syncConfigured } from "../sync/config";
import { useDemo } from "../sync/demo";
import { useSyncState } from "../sync/state";
import { useData } from "./data";
import { announce } from "./UndoHost";

/**
 * Records scheduled RD and bond payments that have come due. Waits for the first sync to settle so a payment
 * recorded on another device is seen first, and never runs in the demo.
 */
export function useAutoPost(): void {
  const { ready, instruments, asOf } = useData();
  const sync = useSyncState();
  const demo = useDemo();
  const settled = !syncConfigured || sync.status === "idle";
  const signature = useMemo(
    () =>
      instruments
        .filter((i) => !i.archived && !i.sample && ((i.details.kind === "rd" && i.details.accountId) || (i.details.kind === "bond" && i.details.payoutAccountId)))
        .map((i) => `${i.id}:${i.details.kind === "rd" ? i.details.accountId : i.details.kind === "bond" ? i.details.payoutAccountId : ""}:${(i.details as { autoLog?: string[] }).autoLog?.length ?? 0}`)
        .join("|"),
    [instruments],
  );

  useEffect(() => {
    if (!ready || demo || !settled || !signature) return;
    void applyAutoPosts(asOf)
      .then((n) => n > 0 && announce(`Recorded ${n} scheduled payment${n === 1 ? "" : "s"} automatically`))
      .catch(() => undefined);
  }, [ready, demo, settled, asOf, signature]);
}
