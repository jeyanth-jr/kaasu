import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBackup, parseBackup, restoreBackup } from "../db/backup";
import { KaasuDB } from "../db/db";
import type { Instrument, Transaction } from "../domain/types";
import { claimDevice, getMeta, syncOnce, wipeLocal, type RemoteRow, type RemoteStore, type RemoteWrite } from "./engine";
import { installTracking } from "./track";

/** An in-memory cloud with the same semantics as the Supabase table (server-assigned seq). */
class FakeCloud implements RemoteStore {
  rows = new Map<string, RemoteRow>();
  seq = 0;
  pushes = 0;
  async push(rows: RemoteWrite[]) {
    this.pushes++;
    for (const r of rows) this.rows.set(`${r.collection}|${r.id}`, { ...r, data: r.data === null ? null : JSON.parse(JSON.stringify(r.data)), seq: ++this.seq });
  }
  async pull(after: number, limit: number) {
    return [...this.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
  }
}

const inst = (id: string, name: string, extra: Partial<Instrument> = {}): Instrument => ({
  id,
  name,
  kind: "stock",
  assetClass: "equity",
  taxClass: "equity",
  emergencyLayer: "none",
  createdAt: "x",
  details: { kind: "stock", exchange: "NSE", symbol: name.toUpperCase() },
  ...extra,
});
const txn = (id: string, instrumentId: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  instrumentId,
  date: "2026-10-01",
  type: "buy",
  qty: 1,
  price: amount / 100,
  amount,
  source: "manual",
  createdAt: "x",
  ...extra,
});

let n = 0;
async function device(): Promise<KaasuDB> {
  const db = new KaasuDB(`dev-${++n}-${Math.random()}`);
  await db.open();
  installTracking(db);
  return db;
}
// Outbox writes land just after each commit.
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe("sync between two devices", () => {
  let cloud: FakeCloud;
  let a: KaasuDB;
  let b: KaasuDB;
  beforeEach(async () => {
    cloud = new FakeCloud();
    a = await device();
    b = await device();
    await claimDevice(a, "u1");
    await claimDevice(b, "u1");
  });

  it("carries creates, edits and deletes across devices", async () => {
    await a.instruments.put(inst("i1", "Infy"));
    await a.txns.put(txn("t1", "i1", 100_00));
    await settle();
    expect(await syncOnce(a, cloud)).toMatchObject({ pushed: 2 });
    await syncOnce(b, cloud);
    expect((await b.instruments.get("i1"))?.name).toBe("Infy");
    expect((await b.txns.get("t1"))?.amount).toBe(100_00);

    await b.txns.update("t1", { amount: 250_00 });
    await settle();
    await syncOnce(b, cloud);
    await syncOnce(a, cloud);
    expect((await a.txns.get("t1"))?.amount).toBe(250_00);

    await a.txns.delete("t1");
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    expect(await b.txns.get("t1")).toBeUndefined();
    expect(cloud.rows.get("txns|t1")).toMatchObject({ deleted: true, data: null });
  });

  it("does not echo remote changes back (applying a pull queues nothing)", async () => {
    await a.instruments.put(inst("i1", "Infy"));
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    await settle();
    expect(await b.outbox.count()).toBe(0);
    const before = cloud.pushes;
    expect(await syncOnce(b, cloud)).toMatchObject({ pushed: 0, applied: 0 });
    expect(cloud.pushes).toBe(before);
  });

  it("keeps a pending local edit over an incoming change, then converges (last push wins)", async () => {
    await a.instruments.put(inst("i1", "Infy"));
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    // Both edit the same record offline.
    await a.instruments.update("i1", { name: "From A" });
    await b.instruments.update("i1", { name: "From B" });
    await settle();
    await syncOnce(a, cloud); // A pushes first
    await syncOnce(b, cloud); // B pushes second: its pending edit is kept, not overwritten by A's
    expect((await b.instruments.get("i1"))?.name).toBe("From B");
    await syncOnce(a, cloud);
    expect((await a.instruments.get("i1"))?.name).toBe("From B");
  });

  it("handles composite keys (prices) and the settings singleton", async () => {
    await a.prices.put({ instrumentId: "i1", date: "2026-10-16", price: 90.5, source: "amfi", fetchedAt: "x" });
    await a.settings.put({ id: "settings", monthlyExpenses: 123_00 } as never);
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    expect(await b.prices.get(["i1", "2026-10-16"])).toMatchObject({ price: 90.5 });
    expect((await b.settings.get("settings"))?.monthlyExpenses).toBe(123_00);
    await a.prices.delete(["i1", "2026-10-16"]);
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    expect(await b.prices.get(["i1", "2026-10-16"])).toBeUndefined();
  });

  it("never uploads sample data, including its deletion", async () => {
    await a.instruments.put(inst("sample-x", "Demo", { sample: true }));
    await a.txns.put(txn("sample-t", "sample-x", 5_00, { source: "sample" }));
    await a.cash.put({ id: "sample-c", date: "2026-10-01", kind: "expense", amount: 1, category: "food", source: "sample", createdAt: "x" });
    await a.prices.put({ instrumentId: "sample-x", date: "2026-10-16", price: 1, source: "sample", fetchedAt: "x" });
    await a.instruments.put(inst("real", "Real"));
    await settle();
    expect(await syncOnce(a, cloud)).toMatchObject({ pushed: 1 });
    await a.instruments.delete("sample-x");
    await a.txns.delete("sample-t");
    await settle();
    await syncOnce(a, cloud);
    expect([...cloud.rows.keys()]).toEqual(["instruments|real"]);
  });

  it("tracks writes in explicit transactions that exclude the outbox, bulk ops and clear()", async () => {
    await a.transaction("rw", [a.cash, a.txns], async () => {
      await a.cash.put({ id: "c1", date: "2026-10-01", kind: "expense", amount: 1_00, category: "food", source: "manual", createdAt: "x" });
      await a.txns.bulkPut([txn("t1", "i1", 1_00), txn("t2", "i1", 2_00)]);
    });
    await settle();
    expect((await a.outbox.toArray()).map((o) => o.key).sort()).toEqual(["cash|c1", "txns|t1", "txns|t2"]);
    await syncOnce(a, cloud);
    await a.txns.clear();
    await settle();
    await syncOnce(a, cloud);
    expect(cloud.rows.get("txns|t1")?.deleted).toBe(true);
    expect(cloud.rows.get("txns|t2")?.deleted).toBe(true);
    expect(cloud.rows.get("cash|c1")?.deleted).toBe(false);
  });

  it("propagates a wholesale replacement (as a backup restore does) as creates and tombstones", async () => {
    await a.instruments.put(inst("keep", "Keep"));
    await a.instruments.put(inst("gone", "Gone"));
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    await a.transaction("rw", [a.instruments], async () => {
      await a.instruments.clear();
      await a.instruments.bulkPut([inst("keep", "Keep"), inst("new", "New")]);
    });
    await settle();
    await syncOnce(a, cloud);
    await syncOnce(b, cloud);
    expect((await b.instruments.toArray()).map((i) => i.id).sort()).toEqual(["keep", "new"]);
  });

  it("pages through large changes", async () => {
    await a.txns.bulkPut(Array.from({ length: 1300 }, (_, i) => txn(`t${i}`, "i1", 1_00 + i)));
    await settle(300);
    expect(await syncOnce(a, cloud)).toMatchObject({ pushed: 1300 });
    expect(await syncOnce(b, cloud)).toMatchObject({ pulled: 1300, applied: 1300 });
    expect(await b.txns.count()).toBe(1300);
  });
});

describe("account ownership of a device", () => {
  it("adopts existing local data on first connect and uploads it", async () => {
    const cloud = new FakeCloud();
    const db = new KaasuDB(`own-${Math.random()}`);
    await db.open();
    await db.instruments.put(inst("old", "Written before sync existed")); // no tracking yet
    installTracking(db);
    expect(await claimDevice(db, "u1")).toBe("adopted");
    expect(await syncOnce(db, cloud)).toMatchObject({ pushed: 1 });
    expect(await claimDevice(db, "u1")).toBe("same");
    expect(await claimDevice(db, "u2")).toBe("different");
  });

  it("wipes local data for a different account without uploading the deletions", async () => {
    const cloud = new FakeCloud();
    const db = await device();
    await claimDevice(db, "u1");
    await db.instruments.put(inst("i1", "Mine"));
    await settle();
    await syncOnce(db, cloud);
    await wipeLocal(db, "u2");
    await settle();
    expect(await db.instruments.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta(db)).toMatchObject({ userId: "u2", cursor: 0 });
    expect(cloud.rows.get("instruments|i1")?.deleted).toBe(false); // account 1's cloud copy is untouched
  });
});

describe("the app's backup/restore with tracking installed", () => {
  it("round-trips and queues the restored records for upload", async () => {
    const mod = await import("../db/db");
    installTracking(mod.db);
    await mod.db.instruments.put(inst("b1", "Backup me"));
    const parsed = parseBackup(JSON.stringify(await createBackup()));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((await restoreBackup(parsed.backup)).ok).toBe(true);
    await settle();
    expect((await mod.db.instruments.get("b1"))?.name).toBe("Backup me");
    expect((await mod.db.outbox.toArray()).some((o) => o.key === "instruments|b1")).toBe(true);
  });
});
