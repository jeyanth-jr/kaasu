import { describe, expect, it } from "vitest";
import { matchFifo, openCost, openQty } from "./lots";
import { txn } from "./test-helpers";

describe("FIFO lot matching", () => {
  it("consumes the oldest lots first, splitting a lot when needed", () => {
    const book = matchFifo([
      txn("buy", "2024-01-10", { id: "a", qty: 10, price: 100 }), // ₹1,000
      txn("buy", "2024-03-10", { id: "b", qty: 10, price: 120 }), // ₹1,200
      txn("sell", "2024-06-10", { id: "s", qty: 15, price: 150 }), // ₹2,250
    ]);
    expect(book.realized).toHaveLength(2);
    const [r1, r2] = book.realized;
    expect(r1).toMatchObject({ lotId: "a", qty: 10, cost: 1000_00, proceeds: 1500_00, gain: 500_00 });
    expect(r2).toMatchObject({ lotId: "b", qty: 5, cost: 600_00, proceeds: 750_00, gain: 150_00 });
    expect(book.open).toEqual([{ id: "b", date: "2024-03-10", qty: 5, cost: 600_00 }]);
    expect(openQty(book)).toBe(5);
    expect(openCost(book)).toBe(600_00);
  });

  it("includes buy charges in cost and deducts sell charges from proceeds", () => {
    const book = matchFifo([
      txn("buy", "2024-01-10", { qty: 4, price: 250, charges: 20_00 }),
      txn("sell", "2024-02-10", { qty: 4, price: 300, charges: 15_00 }),
    ]);
    expect(book.realized[0]).toMatchObject({ cost: 1020_00, proceeds: 1185_00, gain: 165_00 });
  });

  it("allocates sell charges across lots without losing a paisa", () => {
    const book = matchFifo([
      txn("buy", "2024-01-01", { qty: 1, price: 100 }),
      txn("buy", "2024-01-02", { qty: 1, price: 100 }),
      txn("buy", "2024-01-03", { qty: 1, price: 100 }),
      txn("sell", "2024-02-01", { qty: 3, price: 100, charges: 1_00 }),
    ]);
    const proceeds = book.realized.reduce((s, r) => s + r.proceeds, 0);
    expect(proceeds).toBe(300_00 - 1_00);
  });

  it("keeps the remaining cost of a partially sold lot exact", () => {
    const book = matchFifo([
      txn("buy", "2024-01-01", { qty: 3, amount: 100_00 }), // ₹33.333.. per unit
      txn("sell", "2024-02-01", { qty: 1, amount: 50_00 }),
      txn("sell", "2024-03-01", { qty: 1, amount: 50_00 }),
      txn("sell", "2024-04-01", { qty: 1, amount: 50_00 }),
    ]);
    const cost = book.realized.reduce((s, r) => s + r.cost, 0);
    expect(cost).toBe(100_00);
    expect(book.open).toHaveLength(0);
  });

  it("handles fractional mutual fund units", () => {
    const book = matchFifo([
      txn("sip", "2024-01-05", { qty: 12.345, price: 81.0045 }),
      txn("sip", "2024-02-05", { qty: 11.987, price: 83.42 }),
      txn("sell", "2024-03-05", { qty: 20, price: 85 }),
    ]);
    expect(openQty(book)).toBeCloseTo(4.332, 6);
    expect(book.realized.map((r) => r.qty)).toEqual([12.345, 7.655]);
  });

  it("applies splits to open lots and bonus as zero-cost lots dated on allotment", () => {
    const book = matchFifo([
      txn("buy", "2023-01-01", { id: "a", qty: 10, price: 1000 }),
      txn("split", "2023-06-01", { qty: 5 }), // 1 → 5
      txn("bonus", "2023-09-01", { id: "bonus", qty: 50 }), // 1:1 bonus
      txn("sell", "2024-02-01", { qty: 60, price: 220 }),
    ]);
    expect(book.realized[0]).toMatchObject({ lotId: "a", qty: 50, cost: 10000_00, buyDate: "2023-01-01" });
    expect(book.realized[1]).toMatchObject({ lotId: "bonus", qty: 10, cost: 0, buyDate: "2023-09-01" });
    expect(openQty(book)).toBe(40);
  });

  it("orders same-day buys before sells", () => {
    const book = matchFifo([
      txn("sell", "2024-05-05", { qty: 5, price: 110 }),
      txn("buy", "2024-05-05", { qty: 5, price: 100 }),
    ]);
    expect(book.warnings).toHaveLength(0);
    expect(book.realized[0]?.gain).toBe(50_00);
  });

  it("reports overselling without throwing and keeps partial results", () => {
    const book = matchFifo([
      txn("buy", "2024-01-01", { qty: 2, price: 100 }),
      txn("sell", "2024-02-01", { id: "over", qty: 5, price: 100 }),
    ]);
    expect(book.realized).toHaveLength(1);
    expect(book.warnings[0]?.txnId).toBe("over");
    expect(openQty(book)).toBe(0);
  });

  it("respects asOf", () => {
    const book = matchFifo(
      [txn("buy", "2024-01-01", { qty: 2, price: 100 }), txn("sell", "2024-06-01", { qty: 2, price: 100 })],
      { asOf: "2024-03-01" },
    );
    expect(openQty(book)).toBe(2);
  });

  it("ignores income transactions", () => {
    const book = matchFifo([
      txn("buy", "2024-01-01", { qty: 2, price: 100 }),
      txn("dividend", "2024-02-01", { amount: 10_00 }),
    ]);
    expect(openQty(book)).toBe(2);
    expect(book.realized).toHaveLength(0);
  });
});
