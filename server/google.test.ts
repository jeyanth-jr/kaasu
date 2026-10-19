import { describe, expect, it } from "vitest";
import { googleQuoteUrl, parseGoogleQuote } from "./google";

// Trimmed from the shape of a real quote page: the requested security plus a related one.
const PAGE = `<script>AF_initDataCallback({key: 'ds:13', hash: '9', data:[[[["/g/related1",["RELIANCE","NSE"],"Reliance Industries Ltd",0,"INR",[1220.4,9.2,0.76,2,2,2],null,1211.2,"#987f4b","IN","/m/0242c6",[1792386671],"Asia/Calcutta"]],
[["/g/1hbvhj0n1",["INFY","NSE"],"Infosys Ltd",0,"INR",[1143.9,-17.299927,-1.4898318,2,2,2],null,1161.2,"#3c84c3","IN","/m/01k8x6",[1792386785],"Asia/Calcutta",19800]],
[["/g/mm",["M\\u0026M","NSE"],"Mahindra \\u0026 Mahindra Ltd",0,"INR",[3210.5,1,0.03,2,2,2],null,3209.5,"#c00","IN","/m/x",[1792386000]]],
[["/g/bse",["500325","BOM"],"Reliance Industries Ltd",0,"INR",[1221.15,11.15,0.92,2,2,2],null,1210,"#987f4b","IN","/m/0242c6",[1792386813]]]]});</script>`;

describe("Google Finance quote parsing", () => {
  it("reads price, previous close and trade time for the exact symbol", () => {
    expect(parseGoogleQuote(PAGE, "INFY", "NSE")).toEqual({
      price: 1143.9,
      prevClose: 1161.2,
      time: new Date(1792386785 * 1000).toISOString(),
      name: "Infosys Ltd",
      currency: "INR",
    });
  });

  it("never returns a related security for an unknown symbol", () => {
    expect(parseGoogleQuote(PAGE, "NOPE123", "NSE")).toBeNull();
    // Same symbol, different exchange is not a match either.
    expect(parseGoogleQuote(PAGE, "INFY", "BSE")).toBeNull();
  });

  it("handles BSE scrip codes and JSON-escaped ampersands", () => {
    expect(parseGoogleQuote(PAGE, "500325", "BSE")?.price).toBe(1221.15);
    const mm = parseGoogleQuote(PAGE, "M&M", "NSE");
    expect(mm?.price).toBe(3210.5);
    expect(mm?.name).toBe("Mahindra & Mahindra Ltd");
  });

  it("builds quote URLs with Google's exchange codes", () => {
    expect(googleQuoteUrl("NSE", "infy")).toBe("https://www.google.com/finance/quote/INFY:NSE?hl=en");
    expect(googleQuoteUrl("BSE", "500325")).toBe("https://www.google.com/finance/quote/500325:BOM?hl=en");
    expect(googleQuoteUrl("NSE", "M&M")).toBe("https://www.google.com/finance/quote/M%26M:NSE?hl=en");
  });
});
