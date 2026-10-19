import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { db, mergeSettings, type PaydayRecord } from "../db/db";
import type { CashEntry } from "../domain/cashflow";
import type { Goal, GoalFund } from "../domain/goals";
import { todayISO } from "../domain/dates";
import { buildPortfolio, type Portfolio } from "../domain/portfolio";
import type { Instrument, Liability, LookThrough, MonthlyPlan, PricePoint, Settings, Transaction } from "../domain/types";

export interface AppData {
  ready: boolean;
  instruments: Instrument[];
  txns: Transaction[];
  prices: PricePoint[];
  lookThrough: LookThrough[];
  plans: MonthlyPlan[];
  liabilities: Liability[];
  cash: CashEntry[];
  paydays: PaydayRecord[];
  goals: Goal[];
  goalFunds: GoalFund[];
  settings: Settings;
  asOf: string;
  portfolio: Portfolio;
  instrumentById: Map<string, Instrument>;
}

const Ctx = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(async () => {
    const [instruments, txns, prices, lookThrough, plans, liabilities, cash, paydays, goals, goalFunds, settings] = await Promise.all([
      db.instruments.toArray(),
      db.txns.toArray(),
      db.prices.toArray(),
      db.lookThrough.toArray(),
      db.plans.toArray(),
      db.liabilities.toArray(),
      db.cash.toArray(),
      db.paydays.toArray(),
      db.goals.toArray(),
      db.goalFunds.toArray(),
      db.settings.get("settings"),
    ]);
    return { instruments, txns, prices, lookThrough, plans, liabilities, cash, paydays, goals, goalFunds, settings: mergeSettings(settings) };
  }, []);

  const asOf = todayISO();
  const value = useMemo<AppData>(() => {
    const d = raw ?? {
      instruments: [],
      txns: [],
      prices: [],
      lookThrough: [],
      plans: [],
      liabilities: [],
      cash: [],
      paydays: [],
      goals: [],
      goalFunds: [],
      settings: mergeSettings(undefined),
    };
    const instruments = [...d.instruments].sort((a, b) => a.name.localeCompare(b.name));
    return {
      ready: raw !== undefined,
      ...d,
      instruments,
      asOf,
      portfolio: buildPortfolio({ instruments, txns: d.txns, prices: d.prices, settings: d.settings, asOf }),
      instrumentById: new Map(instruments.map((i) => [i.id, i])),
    };
  }, [raw, asOf]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}
