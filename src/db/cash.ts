import type { CashEntry, EntryKind, StatementRow } from "../domain/cashflow";
import { monthKey } from "../domain/dates";
import type { Paise, Transaction } from "../domain/types";
import { db, newId, nowISO } from "./db";

/**
 * Cash entries can be posted to a cash/savings holding so its balance stays
 * true: income → deposit, expense → withdrawal. The entry owns that mirrored
 * transaction (linkedTxnId) and removes or rewrites it with itself.
 */
function mirrorTxn(e: CashEntry, id: string): Transaction {
  return {
    id,
    instrumentId: e.accountId!,
    date: e.date,
    type: e.kind === "income" ? "deposit" : "withdrawal",
    amount: e.amount,
    notes: e.note ? `${e.note} (from Money)` : "From Money",
    source: "manual",
    createdAt: e.createdAt,
  };
}

export interface EntryInput {
  date: string;
  kind: EntryKind;
  amount: Paise;
  category: string;
  note?: string;
  accountId?: string;
  postToAccount?: boolean;
  source?: CashEntry["source"];
}

export async function saveEntry(input: EntryInput, existing?: CashEntry): Promise<CashEntry> {
  const entry: CashEntry = {
    id: existing?.id ?? newId("c_"),
    date: input.date,
    kind: input.kind,
    amount: Math.abs(input.amount),
    category: input.category,
    note: input.note?.trim() || undefined,
    accountId: input.accountId || undefined,
    source: input.source ?? existing?.source ?? "manual",
    importBatchId: existing?.importBatchId,
    fingerprint: existing?.fingerprint,
    createdAt: existing?.createdAt ?? nowISO(),
  };
  const post = !!input.postToAccount && !!entry.accountId;
  await db.transaction("rw", [db.cash, db.txns], async () => {
    if (existing?.linkedTxnId && (!post || existing.accountId !== entry.accountId)) await db.txns.delete(existing.linkedTxnId);
    if (post) {
      entry.linkedTxnId = existing?.linkedTxnId && existing.accountId === entry.accountId ? existing.linkedTxnId : newId("t_");
      await db.txns.put(mirrorTxn(entry, entry.linkedTxnId));
    }
    await db.cash.put(entry);
  });
  return entry;
}

export async function deleteEntry(entry: CashEntry): Promise<void> {
  await db.transaction("rw", [db.cash, db.txns, db.paydays], async () => {
    if (entry.linkedTxnId) await db.txns.delete(entry.linkedTxnId);
    await db.cash.delete(entry.id);
    const p = await db.paydays.get(monthKey(entry.date));
    if (p?.salaryEntryId === entry.id) await db.paydays.put({ ...p, salaryEntryId: undefined, updatedAt: nowISO() });
  });
}

/** "Salary in!": records the credit and opens this month's payday checklist. */
export async function confirmSalary(input: { date: string; amount: Paise; accountId?: string; postToAccount: boolean; employer?: string }): Promise<CashEntry> {
  const entry = await saveEntry({
    date: input.date,
    kind: "income",
    amount: input.amount,
    category: "salary",
    note: input.employer ? `Salary · ${input.employer}` : "Salary",
    accountId: input.accountId,
    postToAccount: input.postToAccount,
    source: "payday",
  });
  const month = monthKey(input.date);
  const cur = await db.paydays.get(month);
  await db.paydays.put({ month, salaryEntryId: entry.id, done: cur?.done ?? {}, updatedAt: nowISO() });
  return entry;
}

export async function setChecklistItem(month: string, lineId: string, done: boolean): Promise<void> {
  const cur = await db.paydays.get(month);
  await db.paydays.put({ month, salaryEntryId: cur?.salaryEntryId, done: { ...(cur?.done ?? {}), [lineId]: done }, updatedAt: nowISO() });
}

export interface StatementImportResult {
  added: number;
  duplicates: number;
  batchId: string;
}

/** Import parsed statement rows; rows already imported (same fingerprint) are skipped. */
export async function importStatement(rows: (StatementRow & { include: boolean })[], opts: { accountId?: string; postToAccount: boolean; fileName: string }): Promise<StatementImportResult> {
  const batchId = newId("b_");
  const created = nowISO();
  const known = new Set((await db.cash.where("fingerprint").anyOf(rows.map((r) => r.fingerprint)).toArray()).map((e) => e.fingerprint));
  const entries: CashEntry[] = [];
  const txns: Transaction[] = [];
  let duplicates = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.include) continue;
    if (known.has(r.fingerprint)) {
      duplicates++;
      continue;
    }
    known.add(r.fingerprint);
    const e: CashEntry = {
      id: newId("c_"),
      date: r.date,
      kind: r.kind,
      amount: r.amount,
      category: r.category,
      note: r.description.slice(0, 140),
      accountId: opts.accountId,
      source: "statement",
      importBatchId: batchId,
      fingerprint: r.fingerprint,
      createdAt: new Date(Date.parse(created) + n++).toISOString(),
    };
    if (opts.postToAccount && opts.accountId) {
      e.linkedTxnId = newId("t_");
      txns.push({ ...mirrorTxn(e, e.linkedTxnId), importBatchId: batchId });
    }
    entries.push(e);
  }
  await db.transaction("rw", [db.cash, db.txns, db.imports], async () => {
    await db.cash.bulkAdd(entries);
    if (txns.length) await db.txns.bulkAdd(txns);
    await db.imports.add({ id: batchId, createdAt: created, source: "csv", fileName: opts.fileName, rows: entries.length });
  });
  return { added: entries.length, duplicates, batchId };
}

export async function undoStatementImport(batchId: string): Promise<void> {
  await db.transaction("rw", [db.cash, db.txns, db.imports], async () => {
    await db.cash.where("importBatchId").equals(batchId).delete();
    await db.txns.where("importBatchId").equals(batchId).delete();
    await db.imports.delete(batchId);
  });
}
