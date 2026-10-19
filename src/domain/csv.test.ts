import { describe, expect, it } from "vitest";
import { applyMapping, guessMapping, parseCsvText } from "./csv";

// Synthetic sample in the shape of a typical personal tracker sheet:
// side tables to the right, Indian number formats, D/M/YYYY dates.
const SHEET = [
  'Date,Stock Name,Qty,Avg Price,Current Price,Nett Price,P/L,Current Value,P/L Percentage,,Current value:,"1,00,000"',
  '10/03/2025,Alpha Industries,58,381.62,263.50,22133.96,"-6,851","15,283",-30.95%,,,',
  '8/4/2025,Beta Bank ,15,65.34,78.08,980.1,191.1,1171.2,19.50%,,P/L Amount,',
  "21/10/2025,Gamma Tech,2,,184.4,746.00,0,368.8,0%,,,",
  ",,,,,,,,,,total profit,total loss",
  "31/02/2025,Bad Date Co,1,10,10,10,0,10,0%,,,",
  "1/1/2025,No Qty Ltd,,10,10,10,0,10,0%,,,",
].join("\n");

describe("CSV import", () => {
  const rows = parseCsvText(SHEET);

  it("guesses the header row and the right columns (avg price, not current price)", () => {
    const m = guessMapping(rows);
    expect(m.headerRow).toBe(0);
    expect(m.columns).toMatchObject({ date: 0, name: 1, qty: 2, price: 3, amount: 5 });
  });

  it("parses rows, derives missing price from amount, and explains failures", () => {
    const { rows: ok, errors } = applyMapping(rows, guessMapping(rows));
    expect(ok.map((r) => [r.date, r.name, r.qty, r.amount])).toEqual([
      ["2025-03-10", "Alpha Industries", 58, 2213396],
      ["2025-04-08", "Beta Bank", 15, 98010],
      ["2025-10-21", "Gamma Tech", 2, 74600],
    ]);
    expect(ok[2]?.price).toBe(373);
    expect(ok.every((r) => r.type === "buy" && r.kind === "stock")).toBe(true);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [6, 'Unrecognised date "31/02/2025"'],
      [7, "Missing quantity"],
    ]);
  });

  it("treats name-only rows as section headings that set the instrument type", () => {
    const r = parseCsvText(
      ["Date,Name,Qty,Avg Price", "1/4/2025,Alpha,1,10", ",Mutual funds,,", "2/4/2025,Some Fund,3.5,20", ",Gold Investments,,", "3/4/2025,Coins,2,7000"].join("\n"),
    );
    const res = applyMapping(r, guessMapping(r));
    expect(res.rows.map((x) => x.kind)).toEqual(["stock", "mf", "gold"]);
    expect(res.sections.map((s) => s.label)).toEqual(["Mutual funds", "Gold Investments"]);
    expect(res.errors).toHaveLength(0);
  });

  it("maps explicit transaction types", () => {
    const r = parseCsvText("date,name,type,qty,price\n2025-01-01,X,Sell,2,10\n2025-01-02,X,Dividend,,\n2025-01-03,X,Bought,1,5");
    const m = guessMapping(r);
    m.columns.amount = undefined;
    const res = applyMapping(r, m);
    expect(res.rows.map((x) => x.type)).toEqual(["sell", "buy"]);
    expect(res.errors[0]?.reason).toBe("Missing amount");
  });
});
