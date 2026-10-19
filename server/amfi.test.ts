import { describe, expect, it } from "vitest";
import { amfiDate, parseNavAll, searchSchemes } from "./amfi";

const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

Example Mutual Fund

900001;INF000000001;-;Example Flexi Cap Fund - Direct Plan - Growth;84.1234;17-Oct-2025
900002;INF000000002;INF000000003;Example Flexi Cap Fund - Direct Plan - IDCW;31.5;17-Oct-2025
900003;-;-;Broken Row Fund;N.A.;17-Oct-2025

Open Ended Schemes(Index Funds)

Other AMC

900010;INF000000010;-;Other Nifty 50 Index Fund - Regular Plan - Growth;150.01;16-Oct-2025
`;

describe("AMFI NAVAll parser", () => {
  it("parses rows with category and fund house, skipping invalid NAVs", () => {
    const s = parseNavAll(SAMPLE);
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual({
      code: "900001",
      name: "Example Flexi Cap Fund - Direct Plan - Growth",
      isinGrowth: "INF000000001",
      isinReinvest: undefined,
      nav: 84.1234,
      date: "2025-10-17",
      fundHouse: "Example Mutual Fund",
      category: "Equity Scheme - Flexi Cap Fund",
    });
    expect(s[2]?.category).toBe("Index Funds");
    expect(s[2]?.fundHouse).toBe("Other AMC");
  });

  it("reads the newer 8-column layout (Plan and Option columns) from the header", () => {
    const text = [
      "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
      "",
      "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
      "",
      "Example Mutual Fund",
      "",
      "900001;INF000000001;-;Example Flexi Cap Fund;Direct Plan;Growth Option;84.1234;16-Oct-2026",
    ].join("\n");
    expect(parseNavAll(text)).toEqual([
      {
        code: "900001",
        name: "Example Flexi Cap Fund - Direct Plan - Growth Option",
        isinGrowth: "INF000000001",
        isinReinvest: undefined,
        nav: 84.1234,
        date: "2026-10-16",
        fundHouse: "Example Mutual Fund",
        category: "Equity Scheme - Flexi Cap Fund",
      },
    ]);
  });

  it("converts AMFI dates", () => {
    expect(amfiDate("7-Jan-2026")).toBe("2026-01-07");
    expect(amfiDate("garbage")).toBeNull();
  });

  it("ranks Direct Growth plans first in search", () => {
    const s = parseNavAll(SAMPLE);
    expect(searchSchemes(s, "example flexi").map((x) => x.code)).toEqual(["900001", "900002"]);
    expect(searchSchemes(s, "90001").map((x) => x.code)).toEqual(["900010"]);
  });
});

describe("NavIndex (raw-text lookups for the Worker)", () => {
  it("returns exactly what the full parser returns, for lookups and searches", async () => {
    const { NavIndex } = await import("./amfi");
    const idx = new NavIndex(SAMPLE);
    const all = parseNavAll(SAMPLE);
    for (const s of all) expect(idx.get(s.code)).toEqual(s);
    expect(idx.get("123")).toBeNull();
    expect(idx.get("900003")).toBeNull(); // N.A. NAV
    expect(idx.search("example flexi")).toEqual(searchSchemes(all, "example flexi"));
    expect(idx.search("90001").map((x) => x.code)).toEqual(["900010"]);
    expect(idx.search("nothing like this")).toEqual([]);
  });
});
