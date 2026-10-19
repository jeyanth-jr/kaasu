import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "./accounts";
import { applyAutoPosts, recordSipPaid, skipSip } from "./autopost";
import { db } from "./db";
import { undoLast } from "./undo";
import { accountLedger } from "../domain/accounts";
import type { Instrument } from "../domain/types";

const rd = (accountId: string): Instrument => ({ id: "rd", name: "SBI RD", kind: "rd", assetClass: "debt", taxClass: "slab", emergencyLayer: "second", createdAt: "x", details: { kind: "rd", bank: "SBI", monthlyAmount: 5_000_00, ratePct: 7, start: "2026-01-10", tenureMonths: 6, penaltyPct: 1, accountId, autoFrom: "2026-01-01" } });
const bond = (accountId: string): Instrument => ({ id: "b", name: "NCD", kind: "bond", assetClass: "debt", taxClass: "listedOther", emergencyLayer: "second", createdAt: "x", details: { kind: "bond", issuer: "X", faceValue: 1000, couponPct: 9, payout: "quarterly", maturity: "2027-03-15", tdsPct: 10, listed: true, payoutAccountId: accountId, autoFrom: "2026-01-01" } });

async function balance(id: string) {
  const [txns, cash, instruments] = await Promise.all([db.txns.toArray(), db.cash.toArray(), db.instruments.toArray()]);
  return accountLedger(id, { txns, cash, instrumentById: new Map(instruments.map((i) => [i.id, i])) })[0]?.balance ?? 0;
}

describe("automatic scheduled payments", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("debits the account for each RD instalment and credits it when the RD ends, exactly once", async () => {
    const a = await createAccount({ name: "HDFC", bank: "HDFC", type: "savings", opening: 100_000_00, asOf: "2026-01-01" });
    await db.instruments.put(rd(a.id));

    expect(await applyAutoPosts("2026-03-20")).toBe(3);
    expect(await balance(a.id)).toBe(100_000_00 - 3 * 5_000_00);
    expect(await applyAutoPosts("2026-03-20")).toBe(0);
    expect(await applyAutoPosts("2026-03-25")).toBe(0);

    // A payment the user deletes stays deleted.
    const feb = (await db.txns.where("instrumentId").equals("rd").toArray()).find((t) => t.date === "2026-02-10")!;
    await db.txns.where("fundsTxnId").equals(feb.id).delete();
    await db.txns.delete(feb.id);
    expect(await applyAutoPosts("2026-03-26")).toBe(0);

    expect(await applyAutoPosts("2026-08-01")).toBe(4); // Apr, May, Jun instalments + maturity
    const end = (await db.txns.where("instrumentId").equals("rd").toArray()).find((t) => t.type === "maturity")!;
    expect(end.source).toBe("auto");
    expect(await balance(a.id)).toBe(100_000_00 - 5 * 5_000_00 + end.amount);
  });

  it("credits bond coupons net of TDS and the face value at maturity", async () => {
    const a = await createAccount({ name: "HDFC", bank: "HDFC", type: "savings", opening: 0, asOf: "2026-01-01" });
    await db.instruments.put(bond(a.id));
    await db.txns.put({ id: "buy", instrumentId: "b", date: "2026-01-20", type: "buy", qty: 10, price: 1000, amount: 10_000_00, source: "manual", createdAt: "x" });

    expect(await applyAutoPosts("2026-07-01")).toBe(2);
    const gross = Math.round((10 * 1000 * 100 * 9) / 100 / 4);
    expect(await balance(a.id)).toBe(2 * (gross - Math.round(gross * 0.1)));

    await applyAutoPosts("2027-04-01");
    const redemption = (await db.txns.where("instrumentId").equals("b").toArray()).find((t) => t.type === "redemption")!;
    expect(redemption.amount).toBe(10_000_00);
    expect(await balance(a.id)).toBeGreaterThan(10_000_00);
  });

  it("ignores instruments with no account chosen", async () => {
    await db.instruments.put({ ...rd("x"), details: { ...(rd("x").details as object), accountId: undefined } as Instrument["details"] });
    expect(await applyAutoPosts("2026-08-01")).toBe(0);
    expect(await db.txns.count()).toBe(0);
  });
});

describe("SIP prompts", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("records units at the NAV given, debits the account, and can be undone", async () => {
    const a = await createAccount({ name: "HDFC", bank: "HDFC", type: "savings", opening: 50_000_00, asOf: "2026-01-01" });
    await db.instruments.put({ id: "f", name: "Flexi", kind: "mf", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x", details: { kind: "mf", amfiCode: "1", sip: { amount: 5_000_00, day: 5, start: "2026-01-05" } } });
    await recordSipPaid({ instrumentId: "f", date: "2026-10-05", amount: 5_000_00, nav: 125, accountId: a.id });
    const t = (await db.txns.where("instrumentId").equals("f").toArray())[0]!;
    expect(t).toMatchObject({ type: "sip", qty: 40, price: 125, amount: 5_000_00 });
    expect(await balance(a.id)).toBe(45_000_00);
    expect((await db.settings.get("settings"))?.lastAccountId).toBe(a.id);

    await undoLast();
    expect(await db.txns.where("instrumentId").equals("f").count()).toBe(0);
    expect(await balance(a.id)).toBe(50_000_00);

    await expect(recordSipPaid({ instrumentId: "f", date: "2026-10-05", amount: 5_000_00, nav: 0 })).rejects.toThrow();
  });

  it("remembers a skipped month", async () => {
    await db.instruments.put({ id: "f", name: "Flexi", kind: "mf", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x", details: { kind: "mf", amfiCode: "1", sip: { amount: 1, day: 5, start: "2026-01-05" } } });
    await skipSip("f", "2026-10-05");
    await skipSip("f", "2026-10-05");
    const inst = await db.instruments.get("f");
    expect(inst?.details.kind === "mf" && inst.details.sip?.skipped).toEqual(["2026-10"]);
  });
});
