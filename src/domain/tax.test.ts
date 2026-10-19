import { describe, expect, it } from "vitest";
import { DEFAULT_TAX, type TaxConfig } from "./types";
import {
  bucketize,
  computeTax,
  emptyBuckets,
  harvestZeroTax,
  holdingDays,
  longTermFrom,
  termOf,
  turningLongSoon,
} from "./tax";

const cfg: TaxConfig = { ...DEFAULT_TAX, cessPct: 0, slabPct: 30 };

describe("holding period", () => {
  it("turns long-term only after more than 12 months", () => {
    expect(longTermFrom("2025-01-15", 12)).toBe("2026-01-16");
    expect(termOf("equity", "2025-01-15", "2026-01-15", cfg)).toBe("short");
    expect(termOf("equity", "2025-01-15", "2026-01-16", cfg)).toBe("long");
  });

  it("clamps month ends (31-Jan, 29-Feb)", () => {
    expect(longTermFrom("2024-02-29", 12)).toBe("2025-03-01");
    expect(longTermFrom("2023-03-31", 12)).toBe("2024-04-01");
    expect(longTermFrom("2024-01-31", 24)).toBe("2026-02-01");
  });

  it("uses 24 months for unlisted assets and never long-term for slab assets", () => {
    expect(termOf("unlistedOther", "2023-01-01", "2024-06-01", cfg)).toBe("short");
    expect(termOf("unlistedOther", "2023-01-01", "2025-01-02", cfg)).toBe("long");
    expect(termOf("slab", "2010-01-01", "2025-01-01", cfg)).toBe("short");
  });

  it("counts holding days inclusive of leap days", () => {
    expect(holdingDays("2024-01-01", "2025-01-01")).toBe(366);
  });
});

describe("tax split and set-off", () => {
  it("applies the LTCG exemption before the 12.5% rate", () => {
    const b = emptyBuckets();
    b.equityLt = 2_00_000_00; // ₹2L LTCG
    const t = computeTax(b, cfg);
    expect(t.exemptionUsed).toBe(1_25_000_00);
    expect(t.exemptionRemaining).toBe(0);
    expect(t.taxByBucket.equityLt).toBe(Math.round(75_000_00 * 0.125)); // ₹9,375
  });

  it("taxes STCG at 20% and leaves the exemption untouched", () => {
    const b = emptyBuckets();
    b.equitySt = 50_000_00;
    const t = computeTax(b, cfg);
    expect(t.tax).toBe(10_000_00);
    expect(t.exemptionRemaining).toBe(1_25_000_00);
  });

  it("lets short-term losses offset long-term gains but not the reverse", () => {
    const st = emptyBuckets();
    st.equitySt = -40_000_00;
    st.equityLt = 1_50_000_00;
    const a = computeTax(st, cfg);
    expect(a.net.equityLt).toBe(1_10_000_00);
    expect(a.tax).toBe(0); // within exemption after set-off

    const lt = emptyBuckets();
    lt.equityLt = -40_000_00;
    lt.equitySt = 1_00_000_00;
    const b = computeTax(lt, cfg);
    expect(b.net.equitySt).toBe(1_00_000_00);
    expect(b.unabsorbedLt).toBe(40_000_00);
    expect(b.tax).toBe(20_000_00);
  });

  it("offsets non-exempt long-term gains before equity LTCG", () => {
    const b = emptyBuckets();
    b.equityLt = 1_00_000_00;
    b.listedLt = 30_000_00; // e.g. gold ETF
    b.equitySt = -30_000_00;
    const t = computeTax(b, cfg);
    expect(t.net.listedLt).toBe(0);
    expect(t.net.equityLt).toBe(1_00_000_00);
    expect(t.tax).toBe(0);
  });

  it("offsets short-term losses against the highest-rate short-term bucket first", () => {
    const b = emptyBuckets();
    b.equitySt = 10_000_00; // 20%
    b.slab = 10_000_00; // 30%
    b.equityLt = -1; // ignored, but exercises LT loss path
    b.otherSt = -10_000_00;
    const t = computeTax(b, cfg);
    expect(t.net.slab).toBe(0);
    expect(t.net.equitySt).toBe(10_000_00);
  });

  it("applies cess to capital-gains rates", () => {
    const b = emptyBuckets();
    b.equitySt = 1_00_000_00;
    expect(computeTax(b, { ...cfg, cessPct: 4 }).tax).toBe(20_800_00);
  });

  it("buckets realized items by class and term", () => {
    const b = bucketize(
      [
        { taxClass: "equity", buyDate: "2023-01-01", sellDate: "2024-06-01", gain: 100 },
        { taxClass: "equity", buyDate: "2024-01-01", sellDate: "2024-06-01", gain: 50 },
        { taxClass: "listedOther", buyDate: "2023-01-01", sellDate: "2024-06-01", gain: 20 },
        { taxClass: "slab", buyDate: "2020-01-01", sellDate: "2024-06-01", gain: 7 },
        { taxClass: "none", buyDate: "2020-01-01", sellDate: "2024-06-01", gain: 999 },
      ],
      cfg,
    );
    expect(b).toMatchObject({ equityLt: 100, equitySt: 50, listedLt: 20, slab: 7, otherSt: 0 });
  });
});

describe("harvest helper", () => {
  const asOf = "2025-10-01";

  it("fills the remaining exemption from long-term lots in FIFO order", () => {
    // 100 units bought at ₹100 in 2023, now ₹2,000 → ₹1,900 gain per unit.
    const res = harvestZeroTax(
      [{ instrumentId: "x", taxClass: "equity", unitStep: 1, price: 2000, lots: [{ id: "l1", date: "2023-01-01", qty: 100, cost: 100_00 * 100 }] }],
      emptyBuckets(),
      asOf,
      cfg,
    );
    // floor(1,25,000 / 1,900) = 65 units
    expect(res.suggestions[0]).toMatchObject({ instrumentId: "x", qty: 65, gain: 65 * 1900_00 });
    expect(res.exemptionLeftAfter).toBe(1_25_000_00 - 65 * 1900_00);
  });

  it("stops at a short-term lot with a gain because FIFO would force selling it", () => {
    const res = harvestZeroTax(
      [
        {
          instrumentId: "x",
          taxClass: "equity",
          unitStep: 1,
          price: 200,
          lots: [
            { id: "st", date: "2025-06-01", qty: 10, cost: 1000_00 }, // ST gain
            { id: "lt", date: "2023-01-01", qty: 10, cost: 1000_00 },
          ],
        },
      ],
      emptyBuckets(),
      asOf,
      cfg,
    );
    expect(res.suggestions).toHaveLength(0);
  });

  it("accounts for exemption already used by realized gains", () => {
    const realized = emptyBuckets();
    realized.equityLt = 1_20_000_00;
    const res = harvestZeroTax(
      [{ instrumentId: "x", taxClass: "equity", unitStep: 0.001, price: 110, lots: [{ id: "l", date: "2022-01-01", qty: 1000, cost: 1_00_000_00 }] }],
      realized,
      asOf,
      cfg,
    );
    // ₹5,000 room at ₹10 gain/unit → 500 units
    expect(res.suggestions[0]?.qty).toBeCloseTo(500, 3);
    expect(res.exemptionLeftAfter).toBeLessThan(1_00);
  });

  it("allows selling through an older loss lot (it only lowers tax)", () => {
    const res = harvestZeroTax(
      [
        {
          instrumentId: "x",
          taxClass: "equity",
          unitStep: 1,
          price: 100,
          lots: [
            { id: "loss", date: "2025-05-01", qty: 10, cost: 1500_00 }, // ST loss ₹500
            { id: "gain", date: "2023-01-01", qty: 10, cost: 400_00 }, // LT gain ₹600
          ],
        },
      ],
      emptyBuckets(),
      asOf,
      cfg,
    );
    expect(res.suggestions[0]).toMatchObject({ qty: 20, lotsTouched: 2 });
  });
});

describe("turning long-term soon", () => {
  it("lists gaining lots that become long-term within the window with tax saved", () => {
    const out = turningLongSoon(
      "x",
      "equity",
      [
        { id: "soon", date: "2024-10-20", qty: 10, cost: 1000_00 },
        { id: "far", date: "2025-06-01", qty: 10, cost: 1000_00 },
      ],
      150,
      "2025-10-01",
      30,
      cfg,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ longTermFrom: "2025-10-21", daysLeft: 20, gain: 500_00 });
    expect(out[0]?.taxSaved).toBe(Math.round(500_00 * 0.075));
  });
});
