import { accountDelta, fundingDirection } from "../domain/accounts";
import type { ISODate, Instrument, Paise, Transaction } from "../domain/types";
import { defaultsForKind } from "../domain/types";
import { db, newId, nowISO } from "./db";

export type AccountType = "savings" | "current" | "sweep" | "wallet";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  savings: "Savings",
  current: "Current",
  sweep: "Sweep-in FD",
  wallet: "Wallet / cash",
};

/** Create a bank account (a cash holding) with the balance it has today. */
export async function createAccount(input: { name: string; bank: string; type: AccountType; opening: Paise; asOf: ISODate }): Promise<Instrument> {
  const created = nowISO();
  const account: Instrument = {
    id: newId("i_"),
    name: input.name.trim(),
    kind: "cash",
    ...defaultsForKind("cash"),
    details: { kind: "cash", bank: input.bank.trim() || input.name.trim(), account: input.type },
    createdAt: created,
  };
  await db.transaction("rw", [db.instruments, db.txns], async () => {
    await db.instruments.add(account);
    if (input.opening > 0) {
      await db.txns.add({ id: newId("t_"), instrumentId: account.id, date: input.asOf, type: "deposit", amount: input.opening, opening: true, source: "manual", createdAt: created });
    }
  });
  return account;
}

/** Move money between two accounts: two linked legs, never counted as income or spending. */
export async function transferBetween(input: { fromId: string; toId: string; amount: Paise; date: ISODate; note?: string }): Promise<void> {
  if (input.fromId === input.toId) throw new Error("Pick two different accounts.");
  if (!(input.amount > 0)) throw new Error("Enter an amount.");
  const created = nowISO();
  const transferId = newId("x_");
  const base = { date: input.date, amount: input.amount, notes: input.note?.trim() || undefined, transferId, source: "manual" as const };
  await db.txns.bulkAdd([
    { ...base, id: newId("t_"), instrumentId: input.fromId, type: "withdrawal", createdAt: created },
    { ...base, id: newId("t_"), instrumentId: input.toId, type: "deposit", createdAt: new Date(Date.parse(created) + 1).toISOString() },
  ]);
}

/** Set the balance to what the bank shows today, recording the difference as a correction. */
export async function correctBalance(accountId: string, actual: Paise, date: ISODate): Promise<Paise> {
  const txns = await db.txns.where("instrumentId").equals(accountId).toArray();
  const current = txns.reduce((s, t) => s + accountDelta(t), 0);
  const diff = actual - current;
  if (diff !== 0) {
    await db.txns.add({ id: newId("t_"), instrumentId: accountId, date, type: "balance_adjust", amount: diff, notes: "Matched to bank balance", source: "manual", createdAt: nowISO() });
  }
  return diff;
}

/** The account that paid for / received an investment transaction, if one was chosen. */
export function fundingAccountOf(txnId: string | undefined, txns: Transaction[]): Transaction | undefined {
  return txnId ? txns.find((t) => t.fundsTxnId === txnId) : undefined;
}

/**
 * Keep the bank-account side of an investment transaction in step with it: one mirrored
 * withdrawal/deposit when an account is chosen, none otherwise. The mirror is owned by the
 * investment transaction and is rewritten or removed with it.
 */
export async function syncFunding(txn: Transaction, accountId: string | undefined): Promise<void> {
  const existing = await db.txns.where("fundsTxnId").equals(txn.id).toArray();
  const dir = fundingDirection(txn.type);
  const wanted = accountId && dir && txn.amount > 0 ? accountId : undefined;
  const keep = existing.find((m) => m.instrumentId === wanted);
  for (const m of existing) if (m !== keep) await db.txns.delete(m.id);
  if (!wanted) return;
  const mirror: Transaction = {
    id: keep?.id ?? newId("t_"),
    instrumentId: wanted,
    date: txn.date,
    type: dir === "out" ? "withdrawal" : "deposit",
    // Charges are paid on top of a purchase and netted from sale proceeds.
    amount: Math.max(0, dir === "out" ? txn.amount + (txn.charges ?? 0) : txn.amount - (txn.charges ?? 0) - (txn.tds ?? 0)),
    notes: txn.notes,
    fundsTxnId: txn.id,
    source: "manual",
    createdAt: keep?.createdAt ?? nowISO(),
  };
  await db.txns.put(mirror);
}

/** Delete a transaction together with everything it owns (its funding mirror, or the other leg of a transfer). */
export async function deleteTxnCascade(id: string): Promise<void> {
  await db.transaction("rw", [db.txns, db.cash], async () => {
    const t = await db.txns.get(id);
    if (!t) return;
    await db.txns.where("fundsTxnId").equals(id).delete();
    if (t.transferId) await db.txns.where("transferId").equals(t.transferId).delete();
    // A money entry owns its mirror: removing the mirror removes the entry's link, not the entry.
    const linked = await db.cash.filter((e) => e.linkedTxnId === id).toArray();
    for (const e of linked) await db.cash.put({ ...e, linkedTxnId: undefined });
    await db.txns.delete(id);
  });
}

/** Remove a bank account that has no history, or archive one that has. */
export async function retireAccount(accountId: string): Promise<"deleted" | "archived"> {
  const n = await db.txns.where("instrumentId").equals(accountId).count();
  if (n === 0) {
    await db.instruments.delete(accountId);
    return "deleted";
  }
  const inst = await db.instruments.get(accountId);
  if (inst) await db.instruments.put({ ...inst, archived: true });
  return "archived";
}
