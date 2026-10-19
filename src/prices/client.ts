import { db, nowISO } from "../db/db";
import type { Instrument, PricePoint } from "../domain/types";

/** Client for the local price proxy (server/index.ts), reached via /api. */

export interface RefreshReport {
  message: string;
  updated: number;
  failed: { name: string; reason: string }[];
  proxyOnline: boolean;
}

async function getJson<T>(url: string, timeoutMs = 35_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !body) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return body;
}

export async function proxyOnline(): Promise<boolean> {
  try {
    const r = await getJson<{ ok: boolean }>("/api/health", 3000);
    return r.ok;
  } catch {
    return false;
  }
}

function symbolOf(i: Instrument): { exchange: string; symbol: string } | null {
  const d = i.details;
  if ((d.kind === "stock" || d.kind === "etf") && d.symbol) return { exchange: d.exchange, symbol: d.symbol };
  if (d.kind === "gold" && d.form === "etf" && d.symbol) return { exchange: d.exchange ?? "NSE", symbol: d.symbol };
  return null;
}

export async function refreshPrices(opts: { includeSample?: boolean } = {}): Promise<RefreshReport> {
  const all = (await db.instruments.toArray()).filter((i) => !i.archived && (opts.includeSample || !i.sample));
  if (!(await proxyOnline())) {
    return {
      message: "Price proxy isn't running (start it with npm run dev). Manual prices still work.",
      updated: 0,
      failed: [],
      proxyOnline: false,
    };
  }
  const points: PricePoint[] = [];
  const failed: RefreshReport["failed"] = [];
  const fetchedAt = nowISO();

  const funds = all.filter((i) => i.details.kind === "mf" && i.details.amfiCode);
  if (funds.length) {
    try {
      const codes = funds.map((f) => (f.details as { amfiCode: string }).amfiCode);
      const r = await getJson<{ navs: Record<string, { nav: number; date: string } | null>; stale: boolean }>(`/api/amfi/navs?codes=${codes.join(",")}`);
      for (const f of funds) {
        const n = r.navs[(f.details as { amfiCode: string }).amfiCode];
        if (n) points.push({ instrumentId: f.id, date: n.date, price: n.nav, source: "amfi", fetchedAt });
        else failed.push({ name: f.name, reason: "AMFI code not found" });
      }
    } catch (e) {
      for (const f of funds) failed.push({ name: f.name, reason: (e as Error).message });
    }
  }

  const listed = all.map((i) => ({ i, s: symbolOf(i) })).filter((x): x is { i: Instrument; s: { exchange: string; symbol: string } } => x.s !== null);
  if (listed.length) {
    try {
      const keys = listed.map((x) => `${x.s.exchange}:${x.s.symbol}`);
      const r = await getJson<{ quotes: Record<string, { price: number; prevClose: number | null; date: string } | { error: string }> }>(
        `/api/quote?symbols=${encodeURIComponent(keys.join(","))}`,
      );
      for (const [k, x] of keys.map((k, idx) => [k, listed[idx]!] as const)) {
        const q = r.quotes[k];
        if (q && "price" in q) points.push({ instrumentId: x.i.id, date: q.date, price: q.price, prevClose: q.prevClose ?? undefined, source: "quote", fetchedAt });
        else failed.push({ name: x.i.name, reason: q && "error" in q ? q.error : "no quote" });
      }
    } catch (e) {
      for (const x of listed) failed.push({ name: x.i.name, reason: (e as Error).message });
    }
  }

  if (points.length) await db.prices.bulkPut(points);
  const skippedSample = !opts.includeSample && (await db.instruments.filter((i) => !!i.sample).count()) > 0;
  const parts = [`Updated ${points.length} price${points.length === 1 ? "" : "s"}`];
  if (failed.length) parts.push(`${failed.length} failed (${failed.slice(0, 3).map((f) => f.name).join(", ")}${failed.length > 3 ? "…" : ""}) — enter those manually`);
  if (skippedSample) parts.push("sample holdings keep their sample prices");
  if (funds.length + listed.length === 0) parts.splice(0, 1, "Nothing to price from the web yet — add a fund with an AMFI code or a stock with a symbol");
  return { message: parts.join(" · "), updated: points.length, failed, proxyOnline: true };
}

export async function setManualPrice(instrumentId: string, date: string, price: number): Promise<void> {
  await db.prices.put({ instrumentId, date, price, source: "manual", fetchedAt: nowISO() });
}

export interface SchemeHit {
  code: string;
  name: string;
  nav: number;
  date: string;
  category?: string;
}

export async function searchSchemes(q: string): Promise<SchemeHit[]> {
  const r = await getJson<{ results: SchemeHit[] }>(`/api/amfi/search?q=${encodeURIComponent(q)}`);
  return r.results;
}

export interface SymbolHit {
  symbol: string;
  exchange: "NSE" | "BSE";
  name: string;
  type: "stock" | "etf";
  sector?: string;
}

export async function searchSymbols(q: string): Promise<SymbolHit[]> {
  const r = await getJson<{ results: SymbolHit[] }>(`/api/search?q=${encodeURIComponent(q)}`, 9000);
  return r.results;
}
