import { describe, expect, it } from "vitest";
import { addMonths, financialYear, parseDateFlexible, daysBetween } from "./dates";
import { formatCompact, formatINR, formatPct, parseAmount } from "./money";

describe("Indian number formatting", () => {
  it("groups lakhs and crores", () => {
    expect(formatINR(123456_00)).toBe("₹1,23,456");
    expect(formatINR(1_23_45_678_00)).toBe("₹1,23,45,678");
    expect(formatINR(999_00)).toBe("₹999");
    expect(formatINR(1000_00)).toBe("₹1,000");
    expect(formatINR(12345_67, { decimals: 2 })).toBe("₹12,345.67");
  });

  it("uses explicit signs so colour is never the only cue", () => {
    expect(formatINR(500_00, { sign: true })).toBe("+₹500");
    expect(formatINR(-500_00, { sign: true })).toBe("−₹500");
    expect(formatINR(0, { sign: true })).toBe("₹0");
    expect(formatPct(-3.21, { sign: true })).toBe("−3.2%");
    expect(formatPct(null)).toBe("—");
  });

  it("abbreviates to K / L / Cr", () => {
    expect(formatCompact(1_25_000_00)).toBe("₹1.25L");
    expect(formatCompact(2_50_00_000_00)).toBe("₹2.5Cr");
    expect(formatCompact(45_600_00)).toBe("₹45.6K");
    expect(formatCompact(-12_00_000_00)).toBe("−₹12L");
  });

  it("parses spreadsheet-style amounts", () => {
    expect(parseAmount('"1,23,456.50"'.replace(/"/g, ""))).toBe(123456.5);
    expect(parseAmount("-6,851")).toBe(-6851);
    expect(parseAmount("(1,200)")).toBe(-1200);
    expect(parseAmount("₹ 2,500")).toBe(2500);
    expect(parseAmount("1.5L")).toBe(150000);
    expect(parseAmount("2 Cr")).toBe(20000000);
    expect(parseAmount("42.80%")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("dates", () => {
  it("parses Indian D/M/YYYY dates including single digits", () => {
    expect(parseDateFlexible("8/4/2025")).toBe("2025-04-08");
    expect(parseDateFlexible("21/3/2025")).toBe("2025-03-21");
    expect(parseDateFlexible("03/11/2025")).toBe("2025-11-03");
    expect(parseDateFlexible("21-Mar-25")).toBe("2025-03-21");
    expect(parseDateFlexible("2025-03-21")).toBe("2025-03-21");
    expect(parseDateFlexible("31/02/2025")).toBeNull();
    expect(parseDateFlexible("3/11/2025", "mdy")).toBe("2025-03-11");
  });

  it("finds the April–March financial year", () => {
    expect(financialYear("2025-03-31")).toEqual({ label: "2024-25", start: "2024-04-01", end: "2025-03-31" });
    expect(financialYear("2025-04-01").label).toBe("2025-26");
  });

  it("adds months with clamping", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
    expect(addMonths("2025-03-15", -3)).toBe("2024-12-15");
    expect(daysBetween("2025-01-01", "2025-03-01")).toBe(59);
  });
});
