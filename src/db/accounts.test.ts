import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { accountLedger } from "../domain/accounts";
import { addGoalFund, deleteGoal, saveGoal } from "./goals";
import { correctBalance, createAccount, deleteTxnCascade, retireAccount, syncFunding, transferBetween } from "./accounts";
import { db } from "./db";
import type { Instrument, Transaction } from "../domain/types";

const fund: Instrument = { id: "mf", name: "Nifty Fund", kind: "mf", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", details: { kind: "mf", amfiCode: "1" }, createdAt: "x" };
const buy = (id: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({ id, instrumentId: "mf", date: "2026-10-05", type: "sip", qty: 10, price: amount / 1000, amount, source: "manual", createdAt: "x", ...extra });

async function balanceOf(id: string): Promise<number> {
  const [txns, cash, instruments] = await Promise.all([db.txns.toArray(), db.cash.toArray(), db.instruments.toArray()]);
  return accountLedger(id, { txns, cash, instrumentById: new Map(instruments.map((i) => [i.id, i])) })[0]?.balance ?? 0;
}

describe("bank accounts", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.instruments.put(fund);
  });

  it("opens with a balance and tracks every rupee after", async () => {
    const a = await createAccount({ name: "HDFC Savings", bank: "HDFC", type: "savings", opening: 50_000_00, asOf: "2026-10-01" });
    expect(a.kind).toBe("cash");
    expect(await balanceOf(a.id)).toBe(50_000_00);
    const diff = await correctBalance(a.id, 48_500_00, "2026-10-10");
    expect(diff).toBe(-1_500_00);
    expect(await balanceOf(a.id)).toBe(48_500_00);
    expect(await correctBalance(a.id, 48_500_00, "2026-10-11")).toBe(0);
  });

  it("moves money between accounts as two linked legs and removes both together", async () => {
    const a = await createAccount({ name: "A", bank: "A", type: "savings", opening: 10_000_00, asOf: "2026-10-01" });
    const b = await createAccount({ name: "B", bank: "B", type: "savings", opening: 0, asOf: "2026-10-01" });
    await transferBetween({ fromId: a.id, toId: b.id, amount: 3_000_00, date: "2026-10-02", note: "Rent float" });
    expect(await balanceOf(a.id)).toBe(7_000_00);
    expect(await balanceOf(b.id)).toBe(3_000_00);
    await expect(transferBetween({ fromId: a.id, toId: a.id, amount: 1, date: "2026-10-02" })).rejects.toThrow();
    const leg = (await db.txns.where("instrumentId").equals(a.id).toArray()).find((t) => t.transferId)!;
    await deleteTxnCascade(leg.id);
    expect(await balanceOf(a.id)).toBe(10_000_00);
    expect(await balanceOf(b.id)).toBe(0);
  });

  it("pays for an investment from an account and follows the transaction through edits and deletion", async () => {
    const a = await createAccount({ name: "A", bank: "A", type: "savings", opening: 20_000_00, asOf: "2026-10-01" });
    const b = await createAccount({ name: "B", bank: "B", type: "savings", opening: 20_000_00, asOf: "2026-10-01" });
    const t = buy("t1", 5_000_00, { charges: 10_00 });
    await db.txns.put(t);
    await syncFunding(t, a.id);
    expect(await balanceOf(a.id)).toBe(20_000_00 - 5_010_00);

    // Pay from the other account instead: the first is made whole.
    await syncFunding(t, b.id);
    expect(await balanceOf(a.id)).toBe(20_000_00);
    expect(await balanceOf(b.id)).toBe(20_000_00 - 5_010_00);

    // Editing the amount rewrites the same mirror rather than adding another.
    await syncFunding({ ...t, amount: 6_000_00, charges: 0 }, b.id);
    expect((await db.txns.where("fundsTxnId").equals("t1").toArray()).length).toBe(1);
    expect(await balanceOf(b.id)).toBe(14_000_00);

    // Not tracked: nothing left on any account.
    await syncFunding(t, undefined);
    expect(await balanceOf(b.id)).toBe(20_000_00);

    await syncFunding(t, a.id);
    await deleteTxnCascade("t1");
    expect(await balanceOf(a.id)).toBe(20_000_00);
    expect(await db.txns.where("fundsTxnId").equals("t1").count()).toBe(0);
  });

  it("credits sale proceeds net of charges and TDS, and ignores transactions that move no money", async () => {
    const a = await createAccount({ name: "A", bank: "A", type: "savings", opening: 0, asOf: "2026-10-01" });
    const sell = buy("s1", 10_000_00, { type: "sell", charges: 50_00, tds: 100_00 });
    await db.txns.put(sell);
    await syncFunding(sell, a.id);
    expect(await balanceOf(a.id)).toBe(9_850_00);
    const bonus = buy("b1", 0, { type: "bonus" });
    await db.txns.put(bonus);
    await syncFunding(bonus, a.id);
    expect(await db.txns.where("fundsTxnId").equals("b1").count()).toBe(0);
  });

  it("archives an account with history and deletes an empty one", async () => {
    const used = await createAccount({ name: "Used", bank: "U", type: "savings", opening: 100, asOf: "2026-10-01" });
    const empty = await createAccount({ name: "Empty", bank: "E", type: "savings", opening: 0, asOf: "2026-10-01" });
    expect(await retireAccount(used.id)).toBe("archived");
    expect((await db.instruments.get(used.id))?.archived).toBe(true);
    expect(await retireAccount(empty.id)).toBe("deleted");
    expect(await db.instruments.get(empty.id)).toBeUndefined();
  });
});

describe("goals", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("creates a goal with money already saved, takes contributions, and removes everything with the goal", async () => {
    const g = await saveGoal({ name: "  Trip ", icon: "plane", term: "short", target: 60_000_00, targetDate: "2027-03-01", alreadySaved: 5_000_00, startDate: "2026-10-01" });
    expect(g.name).toBe("Trip");
    await addGoalFund(g.id, 2_000_00, "2026-10-05", " first ");
    const funds = await db.goalFunds.where("goalId").equals(g.id).toArray();
    expect(funds.map((f) => f.amount).sort((x, y) => x - y)).toEqual([2_000_00, 5_000_00]);
    expect(funds.find((f) => f.amount === 2_000_00)?.note).toBe("first");

    // Editing keeps the start date and does not re-add the opening amount.
    const edited = await saveGoal({ name: "Japan trip", icon: "plane", term: "long", target: 90_000_00, alreadySaved: 9_999_00, startDate: "2030-01-01" }, g);
    expect(edited.startDate).toBe("2026-10-01");
    expect(await db.goalFunds.where("goalId").equals(g.id).count()).toBe(2);

    await deleteGoal(g.id);
    expect(await db.goals.count()).toBe(0);
    expect(await db.goalFunds.count()).toBe(0);
  });
});
