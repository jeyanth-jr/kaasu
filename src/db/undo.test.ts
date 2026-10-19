import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, deleteTxnCascade, syncFunding, transferBetween } from "./accounts";
import { confirmSalary, deleteEntry, saveEntry } from "./cash";
import { db, saveSettings } from "./db";
import { addGoalFund, saveGoal } from "./goals";
import { clearUndo, undoLast, withUndo } from "./undo";

async function balance(id: string): Promise<number> {
  const txns = await db.txns.where("instrumentId").equals(id).toArray();
  return txns.reduce((s, t) => s + (t.type === "deposit" ? t.amount : t.type === "withdrawal" ? -t.amount : 0), 0);
}

describe("undo", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    clearUndo();
  });

  it("takes back a mistyped salary completely: entry, account balance and the payday record", async () => {
    const a = await createAccount({ name: "HDFC", bank: "HDFC", type: "savings", opening: 10_000_00, asOf: "2026-10-01" });
    clearUndo();
    await confirmSalary({ date: "2026-10-02", amount: 25_00_000_00, accountId: a.id, postToAccount: true });
    expect(await balance(a.id)).toBe(10_000_00 + 25_00_000_00);
    expect(await db.paydays.count()).toBe(1);

    expect(await undoLast()).toBe("Salary confirmed");
    expect(await balance(a.id)).toBe(10_000_00);
    expect(await db.cash.count()).toBe(0);
    expect(await db.paydays.count()).toBe(0);
    expect(await undoLast()).toBeNull();
  });

  it("restores an edited entry to its earlier amount and brings back a deleted one", async () => {
    const a = await createAccount({ name: "HDFC", bank: "HDFC", type: "savings", opening: 0, asOf: "2026-10-01" });
    const e = await saveEntry({ date: "2026-10-03", kind: "expense", amount: 500_00, category: "food", accountId: a.id, postToAccount: true });
    expect(await balance(a.id)).toBe(-500_00);

    const edited = await saveEntry({ date: "2026-10-03", kind: "expense", amount: 900_00, category: "food", accountId: a.id, postToAccount: true }, e);
    expect(await balance(a.id)).toBe(-900_00);
    await undoLast();
    expect(await balance(a.id)).toBe(-500_00);
    expect((await db.cash.get(e.id))?.amount).toBe(500_00);

    await deleteEntry(edited);
    expect(await db.cash.count()).toBe(0);
    expect(await balance(a.id)).toBe(0);
    await undoLast();
    expect(await db.cash.count()).toBe(1);
    expect(await balance(a.id)).toBe(-500_00);
  });

  it("undoes a transfer and an investment payment as one step each", async () => {
    const a = await createAccount({ name: "A", bank: "A", type: "savings", opening: 10_000_00, asOf: "2026-10-01" });
    const b = await createAccount({ name: "B", bank: "B", type: "savings", opening: 0, asOf: "2026-10-01" });
    await transferBetween({ fromId: a.id, toId: b.id, amount: 4_000_00, date: "2026-10-02" });
    expect(await balance(b.id)).toBe(4_000_00);
    await undoLast();
    expect(await balance(a.id)).toBe(10_000_00);
    expect(await balance(b.id)).toBe(0);

    await db.instruments.put({ id: "mf", name: "Fund", kind: "mf", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", details: { kind: "mf", amfiCode: "1" }, createdAt: "x" });
    const t = { id: "t1", instrumentId: "mf", date: "2026-10-05", type: "sip" as const, qty: 10, price: 100, amount: 1_000_00, source: "manual" as const, createdAt: "x" };
    await withUndo("Transaction saved", async () => {
      await db.txns.put(t);
      await syncFunding(t, a.id);
    });
    expect(await balance(a.id)).toBe(9_000_00);
    await undoLast();
    expect(await balance(a.id)).toBe(10_000_00);
    expect(await db.txns.get("t1")).toBeUndefined();

    await withUndo("Transaction saved", async () => {
      await db.txns.put(t);
      await syncFunding(t, a.id);
    });
    await deleteTxnCascade("t1");
    expect(await balance(a.id)).toBe(10_000_00);
    await undoLast();
    expect(await db.txns.get("t1")).toBeDefined();
    expect(await balance(a.id)).toBe(9_000_00);
  });

  it("undoes goal changes and settings changes, newest first", async () => {
    const g = await saveGoal({ name: "Trip", icon: "plane", term: "short", target: 50_000_00, startDate: "2026-10-01" });
    await addGoalFund(g.id, 1_000_00, "2026-10-02");
    await withUndo("Payday updated", () => saveSettings({ salary: { amount: 25_000_00, day: 1 } }));
    expect((await db.settings.get("settings"))?.salary?.amount).toBe(25_000_00);

    expect(await undoLast()).toBe("Payday updated");
    expect((await db.settings.get("settings"))?.salary).toBeUndefined();
    expect(await undoLast()).toBe("Added to goal");
    expect(await db.goalFunds.count()).toBe(0);
    expect(await undoLast()).toBe("Goal saved");
    expect(await db.goals.count()).toBe(0);
  });

  it("records nothing for changes made outside an action, and nothing when the action changes nothing", async () => {
    await db.cash.put({ id: "c1", date: "2026-10-01", kind: "expense", amount: 1, category: "food", source: "manual", createdAt: "x" });
    expect(await undoLast()).toBeNull();
    await withUndo("Nothing", async () => undefined);
    expect(await undoLast()).toBeNull();
  });
});
