import { describe, expect, it } from "vitest";
import { searchKnownSymbols } from "./symbols";

describe("offline symbol search", () => {
  it("ignores punctuation, case and spacing", () => {
    expect(searchKnownSymbols("Dr Reddys")[0]?.symbol).toBe("DRREDDY");
    expect(searchKnownSymbols("south indian bank")[0]?.symbol).toBe("SOUTHBANK");
    expect(searchKnownSymbols("infy")[0]?.symbol).toBe("INFY");
    expect(searchKnownSymbols("")).toEqual([]);
  });
});
