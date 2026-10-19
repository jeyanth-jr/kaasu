import { categoryById, type CashEntry } from "./cashflow";
import { monthKey } from "./dates";
import type { ISODate, Instrument, Paise, Transaction } from "./types";

/**
 * Bank accounts are cash holdings. Their balance is the net of every transaction on them, so each
 * rupee in or out is attributable: money entries, investment payments, transfers and corrections.
 */

const IN: ReadonlySet<string> = new Set(["deposit", "interest", "balance_adjust"]);
const OUT: ReadonlySet<string> = new Set(["withdrawal", "fee"]);

/** Signed effect of a cash-account transaction on its balance. */
export function accountDelta(t: Pick<Transaction, "type" | "amount">): Paise {
  return IN.has(t.type) ? t.amount : OUT.has(t.type) ? -t.amount : 0;
}

/** Investment transaction types that pay out of, or into, a bank account. */
const MONEY_OUT: ReadonlySet<string> = new Set(["buy", "sip", "rd_instalment", "deposit", "commitment_payment", "fee"]);
const MONEY_IN: ReadonlySet<string> = new Set(["sell", "dividend", "coupon", "interest", "maturity", "redemption", "withdrawal"]);

/** Direction an investment transaction moves money in a funding account, or null if it moves none. */
export function fundingDirection(type: string): "out" | "in" | null {
  return MONEY_OUT.has(type) ? "out" : MONEY_IN.has(type) ? "in" : null;
}

export type LedgerKind = "entry" | "investment" | "transfer" | "opening" | "adjust" | "interest" | "other";

export interface LedgerRow {
  txnId: string;
  date: ISODate;
  /** Signed paise: positive money in, negative money out. */
  delta: Paise;
  /** Balance after this row. */
  balance: Paise;
  kind: LedgerKind;
  label: string;
  sub?: string;
  entry?: CashEntry;
  /** For transfers, the account at the other end. */
  otherAccountId?: string;
}

export interface LedgerContext {
  txns: Transaction[];
  cash: CashEntry[];
  instrumentById: Map<string, Instrument>;
}

const cmp = (a: Transaction, b: Transaction) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);

function labelOf(type: string): string {
  return type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Every transaction on one account with a running balance, newest first. */
export function accountLedger(accountId: string, ctx: LedgerContext): LedgerRow[] {
  const mine = ctx.txns.filter((t) => t.instrumentId === accountId).sort(cmp);
  const entryByTxn = new Map(ctx.cash.filter((e) => e.linkedTxnId).map((e) => [e.linkedTxnId!, e]));
  const txnById = new Map(ctx.txns.map((t) => [t.id, t]));
  let balance = 0;
  const rows: LedgerRow[] = mine.map((t) => {
    const delta = accountDelta(t);
    balance += delta;
    const row: LedgerRow = { txnId: t.id, date: t.date, delta, balance, kind: "other", label: t.notes || labelOf(t.type) };
    const entry = entryByTxn.get(t.id);
    if (t.transferId) {
      const partner = ctx.txns.find((x) => x.transferId === t.transferId && x.id !== t.id);
      const other = partner ? ctx.instrumentById.get(partner.instrumentId) : undefined;
      row.kind = "transfer";
      row.otherAccountId = partner?.instrumentId;
      row.label = delta < 0 ? `Transfer to ${other?.name ?? "another account"}` : `Transfer from ${other?.name ?? "another account"}`;
      row.sub = t.notes && !/^transfer/i.test(t.notes) ? t.notes : undefined;
    } else if (entry) {
      row.kind = "entry";
      row.entry = entry;
      row.label = categoryById.get(entry.category)?.label ?? entry.category;
      row.sub = entry.note;
    } else if (t.fundsTxnId) {
      const inv = txnById.get(t.fundsTxnId);
      const name = inv ? ctx.instrumentById.get(inv.instrumentId)?.name : undefined;
      row.kind = "investment";
      row.label = `${delta < 0 ? "Paid for" : "Received from"} ${name ?? "an investment"}`;
      row.sub = inv ? labelOf(inv.type) : undefined;
    } else if (t.opening) {
      row.kind = "opening";
      row.label = "Opening balance";
    } else if (t.type === "balance_adjust") {
      row.kind = "adjust";
      row.label = "Balance correction";
      row.sub = t.notes;
    } else if (t.type === "interest") {
      row.kind = "interest";
      row.label = "Interest credited";
    }
    return row;
  });
  return rows.reverse();
}

export interface AccountSummary {
  account: Instrument;
  balance: Paise;
  /** Money in / out this month, leaving out transfers, openings and corrections. */
  inMonth: Paise;
  outMonth: Paise;
  lastDate: ISODate | null;
  count: number;
}

export function summarizeAccount(account: Instrument, ctx: LedgerContext, month: string): AccountSummary {
  const rows = accountLedger(account.id, ctx);
  let inMonth = 0;
  let outMonth = 0;
  for (const r of rows) {
    if (monthKey(r.date) !== month || r.kind === "transfer" || r.kind === "opening" || r.kind === "adjust") continue;
    if (r.delta > 0) inMonth += r.delta;
    else outMonth += -r.delta;
  }
  return { account, balance: rows[0]?.balance ?? 0, inMonth, outMonth, lastDate: rows[0]?.date ?? null, count: rows.length };
}

/** Real (non-sample) cash accounts that are still open. */
export function activeAccounts(instruments: Instrument[]): Instrument[] {
  return instruments.filter((i) => i.kind === "cash" && !i.archived);
}
