import { useEffect, useMemo, useRef } from "react";
import { saveSettings } from "../db/db";
import { monthKey } from "../domain/dates";
import { buildSchedules, scheduleTotals } from "../domain/obligations";
import { detectWins, goalStreak, isSavingTxn, pickToShow, resolveGoal, savedInMonth, type GoalSource, type SavingsSnapshot } from "../domain/savings";
import { useSyncState } from "../sync/state";
import { celebrate } from "./celebrate";
import { useData } from "./data";
import { useEmergency } from "./derived";

export interface SavingsView extends SavingsSnapshot {
  goalSource: GoalSource;
  /** Monthly SIP/RD/chit total, i.e. what the plans alone would save. */
  planned: number;
  hasSample: boolean;
}

/** This month's savings against the goal, plus everything needed to detect milestones. */
export function useSavingsView(): SavingsView {
  const { txns, instrumentById, instruments, liabilities, settings, portfolio, asOf } = useData();
  const emergency = useEmergency();
  const month = monthKey(asOf);

  const planned = useMemo(() => scheduleTotals(buildSchedules({ instruments, txns, liabilities, asOf })).savingPerMonth, [instruments, txns, liabilities, asOf]);
  const goal = resolveGoal({ goal: settings.savingsGoal, planned, salary: settings.salary?.amount });

  return useMemo(
    () => ({
      month,
      saved: savedInMonth(txns, instrumentById, month),
      goal: goal.amount,
      goalSource: goal.source,
      planned,
      netWorth: portfolio.netWorth,
      emergencyMonths: emergency.instantMonths,
      investedCount: txns.filter((t) => isSavingTxn(t, instrumentById)).length,
      streak: goalStreak(txns, instrumentById, month, goal.amount),
      hasSample: instruments.some((i) => i.sample),
    }),
    [month, txns, instrumentById, goal.amount, goal.source, planned, portfolio.netWorth, emergency.instantMonths, instruments],
  );
}

/**
 * Watches for newly crossed milestones and celebrates them. The first look at the data is a silent
 * baseline, and so is anything that changes while a sync is running, so signing in on a new
 * device or opening the app never replays old achievements.
 */
export function useSavingsTracker(): void {
  const { ready, settings } = useData();
  const view = useSavingsView();
  const sync = useSyncState();
  const prev = useRef<SavingsSnapshot | null>(null);
  const celebrated = useRef(new Set<string>());

  useEffect(() => {
    for (const w of settings.wins) celebrated.current.add(w.key);
  }, [settings.wins]);

  const { hasSample, goalSource: _s, planned: _p, ...snapshot } = view;
  const fingerprint = JSON.stringify(snapshot);

  useEffect(() => {
    if (!ready) return;
    const current = JSON.parse(fingerprint) as SavingsSnapshot;
    if (sync.status === "syncing" || !prev.current) {
      prev.current = current;
      return;
    }
    const wins = detectWins(prev.current, current, celebrated.current, { assetWins: !hasSample });
    prev.current = current;
    if (wins.length === 0) return;
    for (const w of wins) celebrated.current.add(w.key);
    const at = new Date().toISOString();
    void saveSettings({ wins: [...settings.wins, ...wins.map((w) => ({ key: w.key, at }))].slice(-300) });
    if (settings.celebrations) {
      pickToShow(wins, 2).forEach((w, i) => setTimeout(() => celebrate(w), i * 900));
    }
  }, [fingerprint, ready, sync.status]);
}
