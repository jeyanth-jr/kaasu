import { addDays, addMonths, daysBetween, monthKey } from "./dates";
import { matchFifo, openQty } from "./lots";
import { roundQty } from "./money";
import { estimateRdMaturity, monthly } from "./schedule";
import type { Instrument, ISODate, Paise, PayoutFrequency, PricePoint, Transaction } from "./types";

/**
 * Payments Kaasu can record without asking, because the user said which account they go through:
 * RD instalments and the RD maturity, bond coupons and the bond's redemption. SIPs are different:
 * the amount of units depends on the NAV, so those are asked about ("have you paid?").
 *
 * Everything here is derived from the instrument's own schedule. Each event has a stable key and a
 * deterministic transaction id, and keys already handled are remembered on the instrument, so running this
 * again, or on another device, never duplicates a payment, and a payment the user deletes stays deleted.
 */

export interface AutoPost {
  /** Remembered on the instrument once handled. */
  key: string;
  instrumentId: string;
  accountId: string;
  txn: Transaction;
}

const FREQ_MONTHS: Record<PayoutFrequency, number> = { monthly: 1, quarterly: 3, halfYearly: 6, yearly: 12, cumulative: 0 };

const stamp = (date: ISODate) => `${date}T06:00:00.000Z`;

function txnOf(inst: Instrument, key: string, date: ISODate, fields: Partial<Transaction> & Pick<Transaction, "type" | "amount">): Transaction {
  return { id: `auto_${inst.id}_${key.replace(/[^A-Za-z0-9-]/g, "_")}`, instrumentId: inst.id, date, source: "auto", createdAt: stamp(date), ...fields };
}

export function planAutoPosts(input: { instruments: Instrument[]; txns: Transaction[]; asOf: ISODate }): AutoPost[] {
  const { asOf } = input;
  const out: AutoPost[] = [];
  for (const inst of input.instruments) {
    if (inst.archived || inst.sample) continue;
    const d = inst.details;
    const mine = input.txns.filter((t) => t.instrumentId === inst.id);

    if (d.kind === "rd" && d.accountId && d.autoFrom) {
      const done = new Set(d.autoLog ?? []);
      const maturity = addMonths(d.start, d.tenureMonths);
      const day = Number(d.start.slice(8, 10));
      for (const date of monthly(day, d.start, addMonths(maturity, -1), d.autoFrom, asOf)) {
        const key = `rd:${date}`;
        if (done.has(key) || mine.some((t) => t.type === "rd_instalment" && monthKey(t.date) === monthKey(date))) continue;
        out.push({ key, instrumentId: inst.id, accountId: d.accountId, txn: txnOf(inst, key, date, { type: "rd_instalment", amount: d.monthlyAmount, notes: "Recorded automatically on schedule" }) });
      }
      if (maturity <= asOf && maturity >= d.autoFrom && !done.has("rd:maturity") && !mine.some((t) => t.type === "maturity")) {
        out.push({
          key: "rd:maturity",
          instrumentId: inst.id,
          accountId: d.accountId,
          txn: txnOf(inst, "rd:maturity", maturity, { type: "maturity", amount: estimateRdMaturity(d.monthlyAmount, d.ratePct, d.tenureMonths), notes: "Estimated maturity amount: edit it if your bank paid a different figure" }),
        });
      }
    }

    if (d.kind === "bond" && d.payoutAccountId && d.autoFrom) {
      const done = new Set(d.autoLog ?? []);
      const firstBuy = mine.filter((t) => t.type === "buy").map((t) => t.date).sort()[0];
      const heldOn = (date: ISODate) => openQty(matchFifo(mine, { asOf: date }));
      const step = FREQ_MONTHS[d.payout];
      if (step > 0 && firstBuy) {
        for (let i = 0; i < 600; i++) {
          const date = addMonths(d.maturity, -i * step);
          if (date < d.autoFrom || date <= firstBuy) break;
          if (date > asOf) continue;
          const key = `cp:${date}`;
          if (done.has(key) || mine.some((t) => t.type === "coupon" && Math.abs(daysBetween(t.date, date)) <= 20)) continue;
          const qty = heldOn(date);
          if (qty <= 0) continue;
          const per = Math.round((qty * d.faceValue * 100 * d.couponPct) / 100 / (12 / step));
          const tds = Math.round((per * d.tdsPct) / 100);
          out.push({ key, instrumentId: inst.id, accountId: d.payoutAccountId, txn: txnOf(inst, key, date, { type: "coupon", amount: per, tds: tds || undefined, notes: "Recorded automatically on schedule" }) });
        }
      }
      if (d.maturity <= asOf && d.maturity >= d.autoFrom && !done.has("bond:maturity") && !mine.some((t) => t.type === "redemption")) {
        const qty = heldOn(d.maturity);
        if (qty > 0) {
          out.push({
            key: "bond:maturity",
            instrumentId: inst.id,
            accountId: d.payoutAccountId,
            txn: txnOf(inst, "bond:maturity", d.maturity, { type: "redemption", qty, price: d.faceValue, amount: Math.round(qty * d.faceValue * 100), notes: "Redeemed at face value on maturity" }),
          });
        }
      }
    }
  }
  return out.sort((a, b) => (a.txn.date < b.txn.date ? -1 : a.txn.date > b.txn.date ? 1 : a.key < b.key ? -1 : 1));
}

// ---------------------------------------------------------------------------
// SIPs: ask, then record

export interface SipDue {
  instrumentId: string;
  name: string;
  /** The scheduled debit date. */
  date: ISODate;
  month: string;
  amount: Paise;
  accountId?: string;
  /** Most recent NAV on file, offered as a starting point. */
  lastNav: number | null;
}

/** SIPs whose debit date has come (within the last two months) with no instalment recorded and no "skipped". */
export function sipsDue(input: { instruments: Instrument[]; txns: Transaction[]; prices: PricePoint[]; asOf: ISODate }): SipDue[] {
  const { asOf } = input;
  const out: SipDue[] = [];
  for (const inst of input.instruments) {
    const d = inst.details;
    if (inst.archived || inst.sample || d.kind !== "mf" || !d.sip) continue;
    const sip = d.sip;
    const from = sip.start > addDays(asOf, -62) ? sip.start : addDays(asOf, -62);
    const latest = input.prices.filter((p) => p.instrumentId === inst.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    for (const date of monthly(sip.day, sip.start, sip.end, from, asOf)) {
      const month = monthKey(date);
      if (sip.skipped?.includes(month)) continue;
      if (input.txns.some((t) => t.instrumentId === inst.id && t.type === "sip" && monthKey(t.date) === month)) continue;
      out.push({ instrumentId: inst.id, name: inst.name, date, month, amount: sip.amount, accountId: sip.accountId, lastNav: latest?.price ?? null });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Units bought for an amount at a NAV, to the four decimals mutual funds report. */
export function unitsFor(amount: Paise, nav: number): number {
  return nav > 0 ? roundQty(amount / 100 / nav) : 0;
}
