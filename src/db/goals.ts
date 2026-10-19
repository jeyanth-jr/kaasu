import type { Goal, GoalFund } from "../domain/goals";
import { db, newId, nowISO } from "./db";

export interface GoalInput {
  name: string;
  icon: string;
  term: Goal["term"];
  target: number;
  targetDate?: string;
  ratePct?: number;
  linkedInstrumentIds?: string[];
  note?: string;
  /** Already set aside when the goal is created. */
  alreadySaved?: number;
  startDate: string;
}

export async function saveGoal(input: GoalInput, existing?: Goal): Promise<Goal> {
  const created = nowISO();
  const goal: Goal = {
    id: existing?.id ?? newId("g_"),
    name: input.name.trim(),
    icon: input.icon,
    term: input.term,
    target: input.target,
    targetDate: input.targetDate || undefined,
    startDate: existing?.startDate ?? input.startDate,
    ratePct: input.ratePct && input.ratePct > 0 ? input.ratePct : undefined,
    linkedInstrumentIds: input.linkedInstrumentIds?.length ? input.linkedInstrumentIds : undefined,
    note: input.note?.trim() || undefined,
    archived: existing?.archived,
    completedAt: existing?.completedAt,
    createdAt: existing?.createdAt ?? created,
  };
  await db.transaction("rw", [db.goals, db.goalFunds], async () => {
    await db.goals.put(goal);
    if (!existing && input.alreadySaved && input.alreadySaved > 0) {
      await db.goalFunds.add({ id: newId("gf_"), goalId: goal.id, date: input.startDate, amount: input.alreadySaved, note: "Already saved", createdAt: created });
    }
  });
  return goal;
}

/** Put money aside for a goal (positive) or take it back out (negative). */
export async function addGoalFund(goalId: string, amount: number, date: string, note?: string): Promise<GoalFund> {
  const f: GoalFund = { id: newId("gf_"), goalId, date, amount, note: note?.trim() || undefined, createdAt: nowISO() };
  await db.goalFunds.add(f);
  return f;
}

export async function deleteGoalFund(id: string): Promise<void> {
  await db.goalFunds.delete(id);
}

export async function deleteGoal(id: string): Promise<void> {
  await db.transaction("rw", [db.goals, db.goalFunds], async () => {
    await db.goalFunds.where("goalId").equals(id).delete();
    await db.goals.delete(id);
  });
}

export async function setGoalArchived(goal: Goal, archived: boolean, completedAt?: string): Promise<void> {
  await db.goals.put({ ...goal, archived: archived || undefined, completedAt: archived ? completedAt : undefined });
}
