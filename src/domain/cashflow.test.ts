import { describe, expect, it } from "vitest";
import {
  budgetLines,
  businessDayOnOrBefore,
  categorize,
  guessStatementMapping,
  monthSummary,
  parseStatement,
  paydayStatus,
  safeToSpend,
  savingsStreak,
  type CashEntry,
} from "./cashflow";
import { parseCsvText } from "./csv";

let n = 0;
const e = (date: string, kind: "income" | "expense", rupees: number, category: string): CashEntry => ({
  id: `e${++n}`,
  date,
  kind,
  amount: rupees * 100,
  category,
  source: "manual",
  createdAt: "x",
});

describe("monthly summary and budgets", () => {
  const entries = [
    e("2026-10-01", "income", 80000, "salary"),
    e("2026-10-02", "expense", 15000, "rent"),
    e("2026-10-05", "expense", 600, "food"),
    e("2026-10-05", "expense", 400, "food"),
    e("2026-10-20", "expense", 3000, "shopping"),
    e("2026-09-30", "expense", 999, "food"), // other month
  ];

  it("totals income, spending, savings rate and daily cumulative spend", () => {
    const s = monthSummary(entries, "2026-10");
    expect(s.income).toBe(80000_00);
    expect(s.expenses).toBe(19000_00);
    expect(s.savingsRate).toBeCloseTo(61000 / 80000, 9);
    expect(s.byCategory[0]).toMatchObject({ amount: 15000_00, count: 1 });
    expect(s.byCategory.find((c) => c.category.id === "food")).toMatchObject({ amount: 1000_00, count: 2 });
    expect(s.dailyCumulative).toHaveLength(31);
    expect(s.dailyCumulative[4]).toBe(16000_00);
    expect(s.dailyCumulative[30]).toBe(19000_00);
  });

  it("flags categories near or over budget, including unbudgeted spend", () => {
    const lines = budgetLines(monthSummary(entries, "2026-10"), { food: 1200_00, rent: 15000_00, travel: 5000_00 });
    const by = Object.fromEntries(lines.map((l) => [l.category.id, l.status]));
    expect(by).toMatchObject({ rent: "near", food: "near", shopping: "none", travel: "ok" });
    const over = budgetLines(monthSummary(entries, "2026-10"), { shopping: 2000_00 });
    expect(over.find((l) => l.category.id === "shopping")?.status).toBe("over");
  });
});

describe("payday", () => {
  const salary = { amount: 80000_00, day: 1 };

  it("moves a weekend payday back to Friday", () => {
    expect(businessDayOnOrBefore("2026-11-01")).toBe("2026-10-30"); // Sunday → Friday
    expect(businessDayOnOrBefore("2026-10-31")).toBe("2026-10-30"); // Saturday → Friday
    expect(businessDayOnOrBefore("2026-10-29")).toBe("2026-10-29");
  });

  it("is upcoming, then due, then received", () => {
    expect(paydayStatus({ amount: 1, day: 25 }, [], "2026-10-19")).toEqual({ state: "upcoming", expectedOn: "2026-10-23", daysLeft: 4 }); // 25th is a Sunday
    expect(paydayStatus(salary, [], "2026-10-19")).toEqual({ state: "due", expectedOn: "2026-10-01", daysLate: 18 });
    expect(paydayStatus(salary, [e("2026-10-01", "income", 80000, "salary")], "2026-10-19")).toEqual({ state: "received", on: "2026-10-01", amount: 80000_00 });
    expect(paydayStatus(null, [], "2026-10-19")).toEqual({ state: "not-set" });
  });

  it("computes safe-to-spend from expected salary before it lands", () => {
    const s = monthSummary([e("2026-10-03", "expense", 2000, "food")], "2026-10");
    const r = safeToSpend({ summary: s, salary, committed: 30000_00, today: "2026-10-19" });
    expect(r).toMatchObject({ income: 80000_00, incomeIsExpected: true, left: 48000_00, daysLeft: 13 });
    expect(r.perDay).toBe(Math.floor(48000_00 / 13));
  });

  it("counts a savings streak over past months", () => {
    const entries = [
      e("2026-09-01", "income", 100, "salary"),
      e("2026-09-02", "expense", 50, "rent"), // 50% saved
      e("2026-08-01", "income", 100, "salary"),
      e("2026-08-02", "expense", 70, "rent"), // 30%
      e("2026-07-01", "income", 100, "salary"),
      e("2026-07-02", "expense", 95, "rent"), // 5% breaks it
    ];
    expect(savingsStreak(entries, "2026-10-19")).toBe(2);
  });
});

describe("bank statement import", () => {
  it("categorises common Indian merchants and salary credits", () => {
    expect(categorize("UPI/SWIGGY/987654/Order", "expense")).toBe("food");
    expect(categorize("NEFT CR-ACME TECH PVT LTD-SALARY OCT", "income")).toBe("salary");
    expect(categorize("POS AMAZON PAY INDIA", "expense")).toBe("shopping");
    expect(categorize("ACH D- BAJAJ FINANCE LTD", "expense")).toBe("emi");
    expect(categorize("UPI/random person", "expense")).toBe("other");
    expect(categorize("Refund from Flipkart", "income")).toBe("refund");
  });

  it("reads separate withdrawal/deposit columns after a preamble", () => {
    const csv = [
      "Account statement for XXXX1234",
      "",
      "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "01/10/26,NEFT CR-ACME TECH-SALARY,N123,01/10/26,,\"80,000.00\",\"1,20,000.00\"",
      "03/10/26,UPI-ZOMATO-ORDER,U1,03/10/26,450.50,,\"1,19,549.50\"",
      "  ,,,,,,",
      "Opening balance,,,,,,",
    ].join("\n");
    const rows = parseCsvText(csv);
    const m = guessStatementMapping(rows)!;
    expect(m).toMatchObject({ headerRow: 2, date: 0, description: 1, debit: 4, credit: 5 });
    const r = parseStatement(rows, m);
    expect(r.rows.map((x) => [x.date, x.kind, x.amount, x.category])).toEqual([
      ["2026-10-01", "income", 80000_00, "salary"],
      ["2026-10-03", "expense", 450_50, "food"],
    ]);
    expect(r.skipped).toBe(1);
  });

  it("reads a signed amount column, or amount + Dr/Cr", () => {
    const signed = parseCsvText("Transaction Date,Description,Amount\n2026-10-05,Uber trip,-320\n2026-10-06,Cashback,25");
    const a = parseStatement(signed, guessStatementMapping(signed)!, "ymd");
    expect(a.rows.map((x) => [x.kind, x.amount, x.category])).toEqual([
      ["expense", 320_00, "transport"],
      ["income", 25_00, "refund"],
    ]);
    const drcr = parseCsvText("Date,Particulars,Amount,Dr/Cr\n05-10-2026,Netflix,649,DR\n06-10-2026,Interest,12,CR");
    const b = parseStatement(drcr, guessStatementMapping(drcr)!);
    expect(b.rows.map((x) => [x.kind, x.category])).toEqual([
      ["expense", "subscriptions"],
      ["income", "other-income"],
    ]);
  });
});
