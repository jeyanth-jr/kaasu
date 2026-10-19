import type { Transaction, TxnType } from "./types";

let seq = 0;

/** Build a transaction for tests. Amount defaults to qty × price in paise. */
export function txn(type: TxnType, date: string, fields: Partial<Transaction> = {}): Transaction {
  seq++;
  const qty = fields.qty;
  const price = fields.price;
  const amount = fields.amount ?? (qty !== undefined && price !== undefined ? Math.round(qty * price * 100) : 0);
  return {
    id: fields.id ?? `t${seq}`,
    instrumentId: fields.instrumentId ?? "i1",
    date,
    type,
    amount,
    source: "manual",
    createdAt: `2000-01-01T00:00:${String(seq % 60).padStart(2, "0")}.${String(seq).padStart(6, "0")}Z`,
    ...fields,
  };
}
