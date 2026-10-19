import { useMemo } from "react";
import { goalProgress, type Goal, type GoalProgress } from "../domain/goals";
import { useData } from "./data";

export interface GoalView {
  goal: Goal;
  progress: GoalProgress;
}

/** Every goal with its progress today: money set aside plus the value of linked holdings. */
export function useGoals(): { active: GoalView[]; reached: GoalView[]; archived: GoalView[] } {
  const { goals, goalFunds, portfolio, asOf } = useData();
  return useMemo(() => {
    const valueOf = new Map(portfolio.holdings.map((h) => [h.instrument.id, h.value]));
    const views = goals.map((goal) => {
      const linkedValue = (goal.linkedInstrumentIds ?? []).reduce((s, id) => s + (valueOf.get(id) ?? 0), 0);
      return { goal, progress: goalProgress({ goal, funds: goalFunds, linkedValue, today: asOf }) };
    });
    const byUrgency = (a: GoalView, b: GoalView) => (a.goal.targetDate ?? "9999") < (b.goal.targetDate ?? "9999") ? -1 : 1;
    return {
      active: views.filter((v) => !v.goal.archived && !v.progress.done).sort(byUrgency),
      reached: views.filter((v) => !v.goal.archived && v.progress.done).sort(byUrgency),
      archived: views.filter((v) => v.goal.archived),
    };
  }, [goals, goalFunds, portfolio, asOf]);
}
