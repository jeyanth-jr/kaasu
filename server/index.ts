/**
 * Kaasu price proxy. The browser app cannot call AMFI or quote sources
 * directly (no CORS), so this small server fetches them on your machine.
 * It stores nothing about your portfolio — it only receives the scheme codes
 * and symbols it is asked to price — and listens on localhost only.
 */
import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNavAll, searchSchemes, type AmfiScheme } from "./amfi";

const PORT = Number(process.env.KAASU_PROXY_PORT ?? 8787);
const HOST = process.env.KAASU_PROXY_HOST ?? "127.0.0.1";
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const NAVALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const UA = "Mozilla/5.0 (Kaasu local portfolio tracker)";

// ---------------------------------------------------------------------------
// AMFI NAVs, cached per IST calendar day (AMFI publishes once each evening)

function istDay(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

interface NavCache {
  day: string;
  fetchedAt: string;
  schemes: AmfiScheme[];
  byCode: Map<string, AmfiScheme>;
  stale: boolean;
}

let navCache: NavCache | null = null;
let navInflight: Promise<NavCache> | null = null;

function makeCache(text: string, day: string, fetchedAt: string, stale: boolean): NavCache {
  const schemes = parseNavAll(text);
  return { day, fetchedAt, schemes, byCode: new Map(schemes.map((s) => [s.code, s])), stale };
}

async function loadNavs(force = false): Promise<NavCache> {
  const today = istDay();
  if (!force && navCache && navCache.day === today && !navCache.stale) return navCache;
  if (navInflight) return navInflight;
  navInflight = (async () => {
    const file = join(CACHE_DIR, `navall-${today}.txt`);
    if (!force) {
      try {
        const text = await readFile(file, "utf8");
        navCache = makeCache(text, today, new Date().toISOString(), false);
        return navCache;
      } catch {
        /* not cached yet */
      }
    }
    try {
      const res = await fetch(NAVALL_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
      const text = await res.text();
      const cache = makeCache(text, today, new Date().toISOString(), false);
      if (cache.schemes.length < 1000) throw new Error(`AMFI file looks truncated (${cache.schemes.length} schemes)`);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, text, "utf8");
      navCache = cache;
      return cache;
    } catch (e) {
      if (navCache) return { ...navCache, stale: true };
      // Fall back to the newest older cache file, flagged stale.
      try {
        const { readdir } = await import("node:fs/promises");
        const files = (await readdir(CACHE_DIR)).filter((f) => f.startsWith("navall-")).sort();
        const last = files.at(-1);
        if (last) {
          const text = await readFile(join(CACHE_DIR, last), "utf8");
          navCache = makeCache(text, last.slice(7, 17), new Date().toISOString(), true);
          return navCache;
        }
      } catch {
        /* no cache dir */
      }
      throw e;
    }
  })().finally(() => {
    navInflight = null;
  });
  return navInflight;
}

// ---------------------------------------------------------------------------
// Stock / ETF quotes via Yahoo Finance's public chart endpoint (unofficial)

interface Quote {
  symbol: string;
  price: number;
  prevClose: number | null;
  date: string;
  time: string;
  currency: string;
  name?: string;
}

const quoteCache = new Map<string, { at: number; q: Quote }>();

function yahooSymbol(exchange: string, symbol: string): string {
  return `${symbol.toUpperCase()}${exchange.toUpperCase() === "BSE" ? ".BO" : ".NS"}`;
}

async function fetchQuote(exchange: string, symbol: string): Promise<Quote> {
  const ys = yahooSymbol(exchange, symbol);
  const hit = quoteCache.get(ys);
  if (hit && Date.now() - hit.at < 60_000) return hit.q;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=5d&interval=1d`;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`quote source responded ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { meta?: Record<string, unknown> }[]; error?: { description?: string } | null };
  };
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(json.chart?.error?.description ?? "no data");
  const price = Number(meta.regularMarketPrice);
  const t = Number(meta.regularMarketTime);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(t)) throw new Error("no price in response");
  const when = new Date(t * 1000);
  const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
  const q: Quote = {
    symbol: ys,
    price,
    prevClose: Number.isFinite(prev) && prev > 0 ? prev : null,
    date: istDay(when),
    time: when.toISOString(),
    currency: String(meta.currency ?? "INR"),
    name: typeof meta.longName === "string" ? meta.longName : typeof meta.shortName === "string" ? meta.shortName : undefined,
  };
  quoteCache.set(ys, { at: Date.now(), q });
  return q;
}

// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "kaasu-proxy", navCachedFor: navCache?.day ?? null });
});

app.get("/api/amfi/navs", async (req, res) => {
  const codes = String(req.query.codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => /^\d{1,8}$/.test(c))
    .slice(0, 500);
  try {
    const cache = await loadNavs(req.query.force === "1");
    const navs: Record<string, { nav: number; date: string; name: string } | null> = {};
    for (const c of codes) {
      const s = cache.byCode.get(c);
      navs[c] = s ? { nav: s.nav, date: s.date, name: s.name } : null;
    }
    res.json({ ok: true, fetchedAt: cache.fetchedAt, stale: cache.stale, navs });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not fetch AMFI NAVs: ${(e as Error).message}` });
  }
});

app.get("/api/amfi/search", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 80);
  try {
    const cache = await loadNavs();
    res.json({
      ok: true,
      results: searchSchemes(cache.schemes, q).map((s) => ({ code: s.code, name: s.name, nav: s.nav, date: s.date, category: s.category, fundHouse: s.fundHouse })),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: (e as Error).message });
  }
});

app.get("/api/quote", async (req, res) => {
  const items = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^(NSE|BSE):[A-Za-z0-9&._-]{1,20}$/.test(s))
    .slice(0, 100);
  const out: Record<string, Quote | { error: string }> = {};
  await Promise.all(
    items.map(async (it) => {
      const [ex, sym] = it.split(":") as [string, string];
      try {
        out[it] = await fetchQuote(ex, sym);
      } catch (e) {
        out[it] = { error: (e as Error).message };
      }
    }),
  );
  res.json({ ok: true, quotes: out });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 60);
  if (!q.trim()) return void res.json({ ok: true, results: [] });
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`search responded ${r.status}`);
    const json = (await r.json()) as { quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchange?: string; sector?: string }[] };
    const results = (json.quotes ?? [])
      .filter((x) => x.symbol && /\.(NS|BO)$/.test(x.symbol))
      .map((x) => ({
        symbol: x.symbol!.replace(/\.(NS|BO)$/, ""),
        exchange: x.symbol!.endsWith(".BO") ? "BSE" : "NSE",
        name: x.longname ?? x.shortname ?? x.symbol!,
        type: x.quoteType === "ETF" ? "etf" : "stock",
        sector: x.sector,
      }));
    res.json({ ok: true, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: (e as Error).message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Kaasu price proxy on http://${HOST}:${PORT}`);
});
