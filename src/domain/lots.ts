import type { ISODate, Paise, Transaction } from "./types";

export interface Lot {
  /** Id of the transaction that opened the lot. */
  id: string;
  date: ISODate;
  qty: number;
  /** Remaining cost basis of this lot in paise (incl. buy charges). */
  cost: Paise;
}

export interface RealizedLot {
  sellTxnId: string;
  lotId: string;
  buyDate: ISODate;
  sellDate: ISODate;
  qty: number;
  cost: Paise;
  proceeds: Paise;
  gain: Paise;
}

export interface LotWarning {
  txnId: string;
  message: string;
}

export interface LotBook {
  open: Lot[];
  realized: RealizedLot[];
  warnings: LotWarning[];
}

const EPS = 1e-6;

/** Same-day ordering: splits apply first, then acquisitions, then disposals. */
const ORDER: Partial<Record<Transaction["type"], number>> = {
  split: 0,
  buy: 1,
  sip: 1,
  bonus: 1,
  sell: 2,
  redemption: 2,
};

export function sortTxns<T extends Pick<Transaction, "date" | "type" | "createdAt">>(txns: T[]): T[] {
  return [...txns].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const oa = ORDER[a.type] ?? 1.5;
    const ob = ORDER[b.type] ?? 1.5;
    if (oa !== ob) return oa - ob;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * FIFO lot matching for market instruments (as Indian depositories do per ISIN).
 * - buy / sip: opens a lot at amount + charges.
 * - bonus: opens a zero-cost lot dated on allotment.
 * - split: multiplies open quantities by `qty` (ratio new/old); cost and dates unchanged.
 * - sell / redemption: consumes oldest lots first; proceeds = amount − charges.
 * Overselling is reported as a warning and the excess ignored, so partial facts survive.
 */
export function matchFifo(txns: Transaction[], opts: { asOf?: ISODate } = {}): LotBook {
  const open: Lot[] = [];
  const realized: RealizedLot[] = [];
  const warnings: LotWarning[] = [];

  for (const t of sortTxns(txns)) {
    if (opts.asOf && t.date > opts.asOf) break;
    switch (t.type) {
      case "buy":
      case "sip": {
        const qty = t.qty ?? 0;
        if (qty <= 0) {
          warnings.push({ txnId: t.id, message: "Buy without a positive quantity was ignored" });
          break;
        }
        open.push({ id: t.id, date: t.date, qty, cost: t.amount + (t.charges ?? 0) });
        break;
      }
      case "bonus": {
        const qty = t.qty ?? 0;
        if (qty > 0) open.push({ id: t.id, date: t.date, qty, cost: 0 });
        break;
      }
      case "split": {
        const ratio = t.qty ?? 0;
        if (ratio <= 0) {
          warnings.push({ txnId: t.id, message: "Split without a positive ratio was ignored" });
          break;
        }
        for (const lot of open) lot.qty = round6(lot.qty * ratio);
        break;
      }
      case "sell":
      case "redemption": {
        let remaining = t.qty ?? 0;
        if (remaining <= 0) {
          warnings.push({ txnId: t.id, message: "Sell without a positive quantity was ignored" });
          break;
        }
        const totalQty = remaining;
        let proceedsLeft = t.amount - (t.charges ?? 0);
        while (remaining > EPS && open.length > 0) {
          const lot = open[0]!;
          const take = Math.min(lot.qty, remaining);
          const fullLot = take >= lot.qty - EPS;
          const cost = fullLot ? lot.cost : Math.round((lot.cost * take) / lot.qty);
          const lastPiece = remaining - take <= EPS;
          const proceeds = lastPiece ? proceedsLeft : Math.round(((t.amount - (t.charges ?? 0)) * take) / totalQty);
          proceedsLeft -= proceeds;
          realized.push({
            sellTxnId: t.id,
            lotId: lot.id,
            buyDate: lot.date,
            sellDate: t.date,
            qty: round6(take),
            cost,
            proceeds,
            gain: proceeds - cost,
          });
          remaining = round6(remaining - take);
          if (fullLot) open.shift();
          else {
            lot.qty = round6(lot.qty - take);
            lot.cost -= cost;
          }
        }
        if (remaining > EPS) {
          warnings.push({
            txnId: t.id,
            message: `Sold ${round6(remaining)} more units than held on ${t.date}; the excess was ignored`,
          });
        }
        break;
      }
      default:
        break; // income and cash types don't touch lots
    }
  }
  return { open, realized, warnings };
}

export function openQty(book: LotBook): number {
  return round6(book.open.reduce((s, l) => s + l.qty, 0));
}

export function openCost(book: LotBook): Paise {
  return book.open.reduce((s, l) => s + l.cost, 0);
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
