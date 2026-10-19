import { describe, expect, it } from "vitest";
import type { ParsedRow } from "./csv";
import { confidentKnownMatch, matchExisting } from "./importMatch";
import type { Instrument } from "./types";

const stock = (id: string, name: string, symbol: string, sample = false): Instrument => ({
  id, name, kind: "stock", assetClass: "equity", taxClass: "equity", emergencyLayer: "none", createdAt: "x", sample,
  details: { kind: "stock", exchange: "NSE", symbol },
});
const row = (line: number, name: string, symbol?: string): ParsedRow => ({ line, date: "2025-01-01", name, symbol, kind: "stock", type: "buy", qty: 1, price: 1, amount: 100 });

describe("import matching", () => {
  it("never merges imported rows into sample holdings", () => {
    const m = matchExisting([row(2, "ITC"), row(3, "Infosys", "INFY")], [stock("s1", "ITC", "ITC", true), stock("s2", "Infosys", "INFY", true)]);
    expect(m.get(2)).toBeNull();
    expect(m.get(3)).toBeNull();
  });

  it("matches your own holdings by symbol, then exact name", () => {
    const mine = [stock("a", "ITC Ltd", "ITC"), stock("b", "Karnataka Bank", "KTKBANK")];
    const m = matchExisting([row(2, "Something", "ITC"), row(3, "karnataka bank"), row(4, "Karnataka")], mine);
    expect(m.get(2)?.id).toBe("a");
    expect(m.get(3)?.id).toBe("b");
    expect(m.get(4)).toBeNull();
  });

  it("only auto-assigns symbols for clear name matches", () => {
    expect(confidentKnownMatch("Dr Reddys")?.symbol).toBe("DRREDDY");
    expect(confidentKnownMatch("South Indian bank")?.symbol).toBe("SOUTHBANK");
    expect(confidentKnownMatch("ITC")?.symbol).toBe("ITC");
    expect(confidentKnownMatch("Tata Motors PVL")).toBeUndefined();
    expect(confidentKnownMatch("PNB Hosuing Finance")).toBeUndefined();
  });
});
