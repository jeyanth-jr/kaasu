import { describe, expect, it } from "vitest";
import { searchVariants } from "./search";

describe("symbol search fallbacks", () => {
  it("tries the full name, then shorter prefixes, then distinctive words", () => {
    expect(searchVariants("PNB Hosuing Finance")).toEqual(["PNB Hosuing Finance", "PNB Hosuing", "PNB", "Hosuing", "Finance"]);
    expect(searchVariants("Tata Motors PVL")).toEqual(["Tata Motors PVL", "Tata Motors", "Tata", "Motors", "PVL"]);
  });

  it("drops generic words and punctuation, and dedupes", () => {
    expect(searchVariants("Dr. Reddy's Ltd")).toEqual(["Dr. Reddys Ltd", "Dr. Reddys", "Dr.", "Reddys"]);
    expect(searchVariants("ITC")).toEqual(["ITC"]);
    expect(searchVariants("   ")).toEqual([]);
  });
});
