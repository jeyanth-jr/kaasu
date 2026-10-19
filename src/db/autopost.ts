import { planAutoPosts, unitsFor } from "../domain/autopost";
import { monthKey } from "../domain/dates";
import type { ISODate, Instrument, Paise } from "../domain/types";
import { syncFunding } from "./accounts";
import { db, newId, nowISO, saveSettings } from "./db";
import { withUndo } from "./undo";

/**
 * Record the scheduled payments that have come due (RD instalments and maturity, bond coupons and
 * redemption) for instruments that name an account. Returns how many were recorded.
 */
export async function applyAutoPosts(asOf: ISODate): Promise<number> {
  const instruments = (await db.instruments.toArray()).filter((i) => !i.archived && !i.sample && ((i.details.kind === "rd" && i.details.accountId) || (i.details.kind === "bond" && i.details.payoutAccountId)));
  if (instruments.length === 0) return 0;
  const ids = instruments.map((i) => i.id);
  const txns = await db.txns.where("instrumentId").anyOf(ids).toArray();
  const plan = planAutoPosts({ instruments, txns, asOf });
  if (plan.length === 0) return 0;

  await db.transaction("rw", [db.instruments, db.txns], async () => {
    const keysByInstrument = new Map<string, string[]>();
    for (const p of plan) {
      await db.txns.put(p.txn);
      await syncFunding(p.txn, p.accountId);
      keysByInstrument.set(p.instrumentId, [...(keysByInstrument.get(p.instrumentId) ?? []), p.key]);
    }
    for (const [id, keys] of keysByInstrument) {
      const inst = await db.instruments.get(id);
      if (!inst || (inst.details.kind !== "rd" && inst.details.kind !== "bond")) continue;
      const log = [...new Set([...(inst.details.autoLog ?? []), ...keys])];
      await db.instruments.put({ ...inst, details: { ...inst.details, autoLog: log } as Instrument["details"] });
    }
  });
  return plan.length;
}

/** "Yes, I paid my SIP": record the instalment at the NAV given, debited from the chosen account. */
export function recordSipPaid(input: { instrumentId: string; date: ISODate; amount: Paise; nav: number; accountId?: string }): Promise<void> {
  return withUndo("SIP recorded", async () => {
    const units = unitsFor(input.amount, input.nav);
    if (!(units > 0)) throw new Error("Enter the NAV the units were allotted at.");
    const txn = { id: newId("t_"), instrumentId: input.instrumentId, date: input.date, type: "sip" as const, qty: units, price: input.nav, amount: input.amount, notes: "SIP", source: "manual" as const, createdAt: nowISO() };
    await db.txns.add(txn);
    await syncFunding(txn, input.accountId);
    if (input.accountId) await saveSettings({ lastAccountId: input.accountId });
  });
}

/** "Not paid this month": remember it so Kaasu stops asking about that month. */
export function skipSip(instrumentId: string, date: ISODate): Promise<void> {
  return withUndo("SIP skipped", async () => {
    const inst = await db.instruments.get(instrumentId);
    if (!inst || inst.details.kind !== "mf" || !inst.details.sip) return;
    const sip = { ...inst.details.sip, skipped: [...new Set([...(inst.details.sip.skipped ?? []), monthKey(date)])] };
    await db.instruments.put({ ...inst, details: { ...inst.details, sip } });
  });
}
