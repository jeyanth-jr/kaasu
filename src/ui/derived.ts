import { useMemo } from "react";
import { allocationView, type AllocationView } from "../domain/allocation";
import { addDays } from "../domain/dates";
import { analyzeEquity, type EquityAnalysis } from "../domain/equity";
import type { Holding } from "../domain/portfolio";
import { calendarEvents, emergencyView, type CalEvent, type EmergencyView } from "../domain/schedule";
import type { AssetClass, Paise } from "../domain/types";
import { useData } from "./data";

/** Holdings that take part in allocation (respecting the commitments and emergency-fund toggles). */
export function allocationHoldings(holdings: Holding[], includeCommitments: boolean, excludeEmergency: boolean): Holding[] {
  return holdings.filter((h) => {
    if (h.closed || h.value <= 0) return false;
    if (h.instrument.kind === "commitment" && !includeCommitments) return false;
    if (excludeEmergency && h.instrument.emergencyLayer === "instant") return false;
    return true;
  });
}

export function useAllocation(): { view: AllocationView; values: Record<AssetClass, Paise>; holdings: Holding[] } {
  const { portfolio, settings } = useData();
  return useMemo(() => {
    const holdings = allocationHoldings(portfolio.holdings, settings.includeCommitments, settings.excludeEmergencyFromAllocation);
    const values: Record<AssetClass, Paise> = { equity: 0, debt: 0, gold: 0, cash: 0, other: 0 };
    for (const h of holdings) values[h.instrument.assetClass] += h.value;
    return { view: allocationView(values, settings.bands), values, holdings };
  }, [portfolio, settings]);
}

export function useEquity(): EquityAnalysis {
  const { portfolio, lookThrough, settings } = useData();
  return useMemo(() => analyzeEquity(portfolio.holdings, lookThrough, settings), [portfolio, lookThrough, settings]);
}

export function useEmergency(): EmergencyView {
  const { portfolio, settings } = useData();
  return useMemo(() => emergencyView(portfolio.holdings, settings), [portfolio, settings]);
}

export function useUpcoming(days = 90): CalEvent[] {
  const { instruments, portfolio, liabilities, asOf } = useData();
  return useMemo(
    () => calendarEvents({ instruments, holdings: portfolio.holdings, liabilities, from: asOf, to: addDays(asOf, days) }),
    [instruments, portfolio, liabilities, asOf, days],
  );
}

export const CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Equity",
  debt: "Debt",
  gold: "Gold",
  cash: "Cash",
  other: "Other",
};

export const CLASS_COLOR: Record<AssetClass, string> = {
  equity: "var(--c-equity)",
  debt: "var(--c-debt)",
  gold: "var(--c-gold)",
  cash: "var(--c-cash)",
  other: "var(--c-other)",
};
