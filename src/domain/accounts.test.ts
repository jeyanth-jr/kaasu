import { describe, expect, it } from "vitest";
import { accountDelta, accountLedger, fundingDirection, summarizeAccount } from "./accounts";
import type { CashEntry } from "./cashflow";
import { txn } from "./test-helpers";
import type { Instrument } from "./types";

const inst = (id: string, name: string, kind: Instrument["kind"] = "cash"): Instrument =>
  ({ id, name, kind, assetClass: "cash", taxClass: "none", emergencyLayer: "instant", details: { kind: "cash", bank: name, account: "savings" }, createdAt: "" }) as Instrument;

const A = inst("a", "HDFC Savings");
const B = inst("b", "SBI Salary");
const byId = new Map([A, B, inst("s", "Nifty Fund", "mf")].map((i) => [i.id, i]));

describe("account ledger", () => {
  it("signs deposits, interest and corrections up and withdrawals and fees down", () => {
    expect(accountDelta({ type: "deposit", amount: 500 })).toBe(500);
    expect(accountDelta({ type: "interest", amount: 5 })).toBe(5);
    expect(accountDelta({ type: "balance_adjust", amount: -200 })).toBe(-200);
    expect(accountDelta({ type: "withdrawal", amount: 300 })).toBe(-300);
    expect(accountDelta({ type: "fee", amount: 10 })).toBe(-10);
    expect(accountDelta({ type: "buy", amount: 999 })).toBe(0);
  });

  it("runs a balance and says where every rupee went", () => {
    const entry: CashEntry = { id: "c1", date: "2026-03-05", kind: "expense", amount: 120_000, category: "groceries", note: "BigBasket", linkedTxnId: "t-spend", source: "manual", createdAt: "" };
    const txns = [
      txn("deposit", "2026-03-01", { id: "t-open", instrumentId: "a", amount: 1_000_000, opening: true }),
      txn("withdrawal", "2026-03-05", { id: "t-spend", instrumentId: "a", amount: 120_000 }),
      txn("sip", "2026-03-10", { id: "t-sip", instrumentId: "s", amount: 300_000, qty: 10, price: 300 }),
      txn("withdrawal", "2026-03-10", { id: "t-pay", instrumentId: "a", amount: 300_000, fundsTxnId: "t-sip" }),
      txn("withdrawal", "2026-03-12", { id: "t-x1", instrumentId: "a", amount: 200_000, transferId: "x" }),
      txn("deposit", "2026-03-12", { id: "t-x2", instrumentId: "b", amount: 200_000, transferId: "x" }),
    ];
    const rows = accountLedger("a", { txns, cash: [entry], instrumentById: byId });
    expect(rows.map((r) => r.kind)).toEqual(["transfer", "investment", "entry", "opening"]);
    expect(rows.map((r) => r.balance)).toEqual([380_000, 580_000, 880_000, 1_000_000]);
    expect(rows[0]!.label).toBe("Transfer to SBI Salary");
    expect(rows[0]!.otherAccountId).toBe("b");
    expect(rows[1]!.label).toBe("Paid for Nifty Fund");
    expect(rows[2]!.label).toBe("Groceries");
    expect(rows[2]!.sub).toBe("BigBasket");
    const other = accountLedger("b", { txns, cash: [entry], instrumentById: byId });
    expect(other[0]!.label).toBe("Transfer from HDFC Savings");
  });

  it("summarises the month without counting transfers, openings or corrections as income or spend", () => {
    const txns = [
      txn("deposit", "2026-03-01", { id: "o", instrumentId: "a", amount: 500_000, opening: true }),
      txn("deposit", "2026-03-02", { id: "sal", instrumentId: "a", amount: 400_000 }),
      txn("withdrawal", "2026-03-03", { id: "w", instrumentId: "a", amount: 100_000 }),
      txn("withdrawal", "2026-03-04", { id: "t1", instrumentId: "a", amount: 50_000, transferId: "x" }),
      txn("balance_adjust", "2026-03-05", { id: "adj", instrumentId: "a", amount: -10_000 }),
      txn("deposit", "2026-02-20", { id: "old", instrumentId: "a", amount: 70_000 }),
    ];
    const s = summarizeAccount(A, { txns, cash: [], instrumentById: byId }, "2026-03");
    expect(s.inMonth).toBe(400_000);
    expect(s.outMonth).toBe(100_000);
    expect(s.balance).toBe(500_000 + 400_000 - 100_000 - 50_000 - 10_000 + 70_000);
    expect(s.lastDate).toBe("2026-03-05");
  });

  it("knows which investment transactions move money", () => {
    expect(fundingDirection("buy")).toBe("out");
    expect(fundingDirection("sip")).toBe("out");
    expect(fundingDirection("sell")).toBe("in");
    expect(fundingDirection("dividend")).toBe("in");
    expect(fundingDirection("bonus")).toBeNull();
    expect(fundingDirection("split")).toBeNull();
  });
});
