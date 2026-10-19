import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildPortfolio } from "../domain/portfolio";
import type { StatementRow } from "../domain/cashflow";
import { DEFAULT_SETTINGS } from "../domain/types";
import { confirmSalary, deleteEntry, importStatement, saveEntry, undoStatementImport } from "./cash";
import { db } from "./db";

const account = { id: "sb", name: "Savings", kind: "cash" as const, assetClass: "cash" as const, taxClass: "none" as const, emergencyLayer: "instant" as const, details: { kind: "cash" as const, bank: "X", account: "savings" as const }, createdAt: "x" };

async function balance(): Promise<number> {
  const pf = buildPortfolio({ instruments: await db.instruments.toArray(), txns: await db.txns.toArray(), prices: [], settings: DEFAULT_SETTINGS, asOf: "2026-12-31" });
  return pf.holdings[0]!.value;
}

describe("money entries posted to an account", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.instruments.put(account);
  });

  it("keeps the account balance in step through add, edit and delete", async () => {
    const salary = await confirmSalary({ date: "2026-10-01", amount: 80000_00, accountId: "sb", postToAccount: true });
    expect(await balance()).toBe(80000_00);
    expect((await db.paydays.get("2026-10"))?.salaryEntryId).toBe(salary.id);

    const rent = await saveEntry({ date: "2026-10-02", kind: "expense", amount: 15000_00, category: "rent", accountId: "sb", postToAccount: true });
    expect(await balance()).toBe(65000_00);

    // Edit amount, then stop posting.
    const rent2 = await saveEntry({ date: "2026-10-02", kind: "expense", amount: 16000_00, category: "rent", accountId: "sb", postToAccount: true }, rent);
    expect(await balance()).toBe(64000_00);
    expect(rent2.linkedTxnId).toBe(rent.linkedTxnId);
    await saveEntry({ date: "2026-10-02", kind: "expense", amount: 16000_00, category: "rent" }, rent2);
    expect(await balance()).toBe(80000_00);

    await deleteEntry(salary);
    expect(await balance()).toBe(0);
    expect((await db.paydays.get("2026-10"))?.salaryEntryId).toBeUndefined();
  });

  it("imports a statement once, skips duplicates, and undoes cleanly", async () => {
    const row = (date: string, amount: number, kind: "income" | "expense", d: string): StatementRow & { include: boolean } => ({ line: 1, date, description: d, kind, amount, category: "other", fingerprint: `${date}|${kind}|${amount}|${d}`, include: true });
    const rows = [row("2026-10-01", 80000_00, "income", "sal"), row("2026-10-03", 450_00, "expense", "zomato"), { ...row("2026-10-04", 1, "expense", "skip"), include: false }];
    const a = await importStatement(rows, { accountId: "sb", postToAccount: true, fileName: "s.csv" });
    expect(a).toMatchObject({ added: 2, duplicates: 0 });
    expect(await balance()).toBe(79550_00);
    const b = await importStatement(rows, { accountId: "sb", postToAccount: true, fileName: "s.csv" });
    expect(b).toMatchObject({ added: 0, duplicates: 2 });
    await undoStatementImport(a.batchId);
    expect(await db.cash.count()).toBe(0);
    expect(await balance()).toBe(0);
  });
});
