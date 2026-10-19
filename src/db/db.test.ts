import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildPortfolio, netWorthSeries } from "../domain/portfolio";
import { createBackup, parseBackup, restoreBackup } from "./backup";
import { db, getSettings } from "./db";
import { clearSampleData, loadSampleData } from "./sample";

const asOf = "2026-10-19";

async function snapshot() {
  const [instruments, txns, prices, settings] = await Promise.all([db.instruments.toArray(), db.txns.toArray(), db.prices.toArray(), getSettings()]);
  return { instruments, txns, prices, settings, asOf };
}

describe("sample data, backup and restore", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it("loads a coherent sample portfolio with no lot warnings", async () => {
    await loadSampleData(asOf);
    const s = await snapshot();
    expect(s.instruments.every((i) => i.sample)).toBe(true);
    const pf = buildPortfolio(s);
    expect(pf.holdings.flatMap((h) => h.warnings)).toEqual([]);
    expect(pf.netWorth).toBeGreaterThan(5_00_000_00);
    expect(pf.realized).toBeGreaterThan(0); // the ITC sale
    expect(pf.xirr).not.toBeNull();
    expect(pf.stalePrices.map((h) => h.instrument.name)).toEqual(["Gold coin 24K", "Muthoot Finance NCD 9.0% 2027"]);
    const series = netWorthSeries(s);
    expect(series.length).toBeGreaterThan(24);
    expect(series.at(-1)?.netWorth).toBe(pf.netWorth);
  });

  it("round-trips a backup exactly and rejects a corrupt one", async () => {
    await loadSampleData(asOf);
    const before = await snapshot();
    const backup = await createBackup();
    const text = JSON.stringify(backup);
    await db.delete();
    await db.open();
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const res = await restoreBackup(parsed.backup);
    expect(res.ok).toBe(true);
    const after = await snapshot();
    expect(after.txns.length).toBe(before.txns.length);
    expect(buildPortfolio(after).netWorth).toBe(buildPortfolio(before).netWorth);

    expect(parseBackup("{not json").ok).toBe(false);
    const broken = JSON.parse(text);
    broken.data.txns[0].instrumentId = "missing";
    const r = parseBackup(JSON.stringify(broken));
    expect(r.ok === false && r.error).toMatch(/missing instrument/);
  });

  it("clears exactly the sample rows", async () => {
    await loadSampleData(asOf);
    await db.instruments.put({ id: "mine", name: "Mine", kind: "cash", assetClass: "cash", taxClass: "none", emergencyLayer: "instant", details: { kind: "cash", bank: "X", account: "savings" }, createdAt: "2026-01-01" });
    await db.txns.put({ id: "mt", instrumentId: "mine", date: "2026-01-01", type: "deposit", amount: 100, source: "manual", createdAt: "2026-01-01" });
    await clearSampleData();
    expect((await db.instruments.toArray()).map((i) => i.id)).toEqual(["mine"]);
    expect(await db.txns.count()).toBe(1);
    expect(await db.prices.count()).toBe(0);
    expect(await db.liabilities.count()).toBe(0);
  });
});
