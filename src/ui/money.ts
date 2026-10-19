import { useMemo } from "react";
import { monthStart } from "../domain/dates";
import { defaultPlan } from "../domain/schedule";
import type { Paise } from "../domain/types";
import { useData } from "./data";
import { useEmergency } from "./derived";

export interface Commitment {
  id: string;
  label: string;
  amount: Paise;
  kind: "sip" | "rd" | "commitment" | "emi" | "emergency" | "other";
  emoji: string;
}

const EMOJI: Record<Commitment["kind"], string> = { sip: "📈", rd: "🏦", commitment: "💍", emi: "🧾", emergency: "🛟", other: "📌" };

/**
 * What this month's salary has to cover before anything is "safe to spend":
 * the monthly plan (SIPs, RD, commitments, other planned lines; not the buffer),
 * active EMIs, and an emergency-fund top-up while the fund is below target.
 */
export function useCommitments(month: string, salary: Paise): Commitment[] {
  const { plans, instruments, settings, liabilities } = useData();
  const emergency = useEmergency();
  return useMemo(() => {
    const plan = plans.find((p) => p.month === month) ?? defaultPlan(instruments, settings, month);
    const out: Commitment[] = plan.lines
      .filter((l) => l.category !== "buffer" && l.planned > 0)
      .map((l) => ({ id: `plan-${l.id}`, label: l.label, amount: l.planned, kind: l.category as Commitment["kind"], emoji: EMOJI[l.category as Commitment["kind"]] ?? "📌" }));
    for (const l of liabilities) {
      if (l.endDate >= monthStart(month)) out.push({ id: `emi-${l.id}`, label: `EMI · ${l.name}`, amount: l.emi, kind: "emi", emoji: EMOJI.emi });
    }
    const shortfall = emergency.target - emergency.instant;
    if (shortfall > 0 && salary > 0) {
      const topUp = Math.min(shortfall, Math.round((salary * 0.1) / 100_00) * 100_00);
      if (topUp > 0) out.push({ id: "emergency", label: "Top up emergency fund", amount: topUp, kind: "emergency", emoji: EMOJI.emergency });
    }
    return out;
  }, [plans, instruments, settings, liabilities, month, emergency, salary]);
}
