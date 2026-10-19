/**
 * Kaasu price API: AMFI NAVs, stock/ETF quotes and symbol search.
 *
 * Written against web-standard Request/Response/fetch only, so the same
 * handler runs in Node (local dev, server/node.ts) and in a Cloudflare Worker
 * (worker/index.ts). Platform differences (where the day's NAV file is cached,
 * auth, CORS) are injected. It never receives or stores portfolio data: only
 * scheme codes, symbols and search text.
 */
import { NavIndex, type AmfiScheme } from "./amfi";
import { googleExchange, googleQuoteUrl, parseGoogleQuote } from "./google";
import { searchVariants } from "./search";

export type Provider = "google" | "yahoo";

/** Persists the day's raw NAVAll text so every instance doesn't re-download 1.5 MB. */
export interface NavStore {
  get(day: string): Promise<string | null>;
  put(day: string, text: string): Promise<void>;
  /** Newest stored file (any day), used when AMFI is unreachable. */
  latest(): Promise<{ day: string; text: string } | null>;
}

export interface ApiOptions {
  navStore: NavStore;
  /** Allow ?force=1 to bypass the NAV cache. Off in production so callers can't force re-downloads. */
  allowForceRefresh?: boolean;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

const NAVALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const UA = "Mozilla/5.0 (Kaasu portfolio tracker)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const QUOTE_TTL_MS = 60_000;
const MAX_QUOTES = 100;
const MAX_CODES = 500;
const MIN_NAV_FILE_BYTES = 500_000;

/** Calendar day in India (AMFI publishes once each evening). */
export function istDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

interface Quote {
  provider: Provider;
  symbol: string;
  price: number;
  prevClose: number | null;
  date: string;
  time: string;
  currency: string;
  name?: string;
}

interface SymbolResult {
  symbol: string;
  exchange: "NSE" | "BSE";
  name: string;
  type: "stock" | "etf";
  sector?: string;
}

interface NavState {
  day: string;
  fetchedAt: string;
  index: NavIndex;
  stale: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export function createApi(opts: ApiOptions): (req: Request) => Promise<Response> {
  const now = opts.now ?? (() => new Date());
  const doFetch: typeof fetch = opts.fetchImpl ?? ((...a) => fetch(...a));
  let nav: NavState | null = null;
  let navInflight: Promise<NavState> | null = null;
  const quoteCache = new Map<string, { at: number; q: Quote }>();

  // ---- AMFI ---------------------------------------------------------------

  function looksValid(text: string): boolean {
    return text.length >= MIN_NAV_FILE_BYTES && /scheme\s*code\s*;/i.test(text.slice(0, 2000));
  }

  async function loadNav(force: boolean): Promise<NavState> {
    const today = istDay(now());
    if (!force && nav && nav.day === today && !nav.stale) return nav;
    if (navInflight) return navInflight;
    navInflight = (async (): Promise<NavState> => {
      if (!force) {
        const stored = await opts.navStore.get(today).catch(() => null);
        if (stored && looksValid(stored)) return (nav = { day: today, fetchedAt: now().toISOString(), index: new NavIndex(stored), stale: false });
      }
      try {
        const res = await doFetch(NAVALL_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`AMFI responded ${res.status}`);
        const text = await res.text();
        if (!looksValid(text)) throw new Error("AMFI file looks truncated or changed format");
        await opts.navStore.put(today, text).catch(() => undefined);
        return (nav = { day: today, fetchedAt: now().toISOString(), index: new NavIndex(text), stale: false });
      } catch (e) {
        if (nav) return { ...nav, stale: true };
        const old = await opts.navStore.latest().catch(() => null);
        if (old && looksValid(old.text)) return (nav = { day: old.day, fetchedAt: now().toISOString(), index: new NavIndex(old.text), stale: true });
        throw e;
      }
    })().finally(() => {
      navInflight = null;
    });
    return navInflight;
  }

  // ---- Quotes -------------------------------------------------------------

  async function fetchGoogle(exchange: string, symbol: string): Promise<Quote> {
    const res = await doFetch(googleQuoteUrl(exchange, symbol), {
      headers: { "user-agent": BROWSER_UA, "accept-language": "en-IN,en;q=0.9" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Google Finance responded ${res.status}`);
    const g = parseGoogleQuote(await res.text(), symbol, exchange);
    if (!g) throw new Error(exchange.toUpperCase() === "BSE" ? "not on Google Finance (BSE needs the numeric scrip code, e.g. 500325)" : "symbol not found on Google Finance");
    return { provider: "google", symbol: `${symbol.toUpperCase()}:${googleExchange(exchange)}`, price: g.price, prevClose: g.prevClose, date: istDay(new Date(g.time)), time: g.time, currency: g.currency, name: g.name };
  }

  async function fetchYahoo(exchange: string, symbol: string): Promise<Quote> {
    const ys = `${symbol.toUpperCase()}${exchange.toUpperCase() === "BSE" ? ".BO" : ".NS"}`;
    // range=1d makes chartPreviousClose the previous session's close (with 5d it is the close before the window).
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?range=1d&interval=1d`;
    const res = await doFetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
    const body = (await res.json()) as { chart?: { result?: { meta?: Record<string, unknown> }[]; error?: { description?: string } | null } };
    const meta = body.chart?.result?.[0]?.meta;
    if (!meta) throw new Error(body.chart?.error?.description ?? "no data from Yahoo");
    const price = Number(meta.regularMarketPrice);
    const t = Number(meta.regularMarketTime);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(t)) throw new Error("no price in Yahoo response");
    const when = new Date(t * 1000);
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    return {
      provider: "yahoo",
      symbol: ys,
      price,
      prevClose: Number.isFinite(prev) && prev > 0 ? prev : null,
      date: istDay(when),
      time: when.toISOString(),
      currency: String(meta.currency ?? "INR"),
      name: typeof meta.longName === "string" ? meta.longName : typeof meta.shortName === "string" ? meta.shortName : undefined,
    };
  }

  async function fetchQuote(exchange: string, symbol: string, preferred: Provider): Promise<Quote> {
    const key = `${preferred}:${exchange}:${symbol}`.toUpperCase();
    const hit = quoteCache.get(key);
    if (hit && now().getTime() - hit.at < QUOTE_TTL_MS) return hit.q;
    const order: Provider[] = preferred === "google" ? ["google", "yahoo"] : ["yahoo", "google"];
    const errors: string[] = [];
    for (const p of order) {
      try {
        const q = await (p === "google" ? fetchGoogle(exchange, symbol) : fetchYahoo(exchange, symbol));
        if (quoteCache.size > 2000) quoteCache.clear();
        quoteCache.set(key, { at: now().getTime(), q });
        return q;
      } catch (e) {
        errors.push(`${p}: ${(e as Error).message}`);
      }
    }
    throw new Error(errors.join("; "));
  }

  async function yahooSearch(q: string): Promise<SymbolResult[]> {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
    const r = await doFetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`search responded ${r.status}`);
    const body = (await r.json()) as { quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; sector?: string }[] };
    return (body.quotes ?? [])
      .filter((x) => x.symbol && /\.(NS|BO)$/.test(x.symbol))
      .map((x) => ({
        symbol: x.symbol!.replace(/\.(NS|BO)$/, ""),
        exchange: x.symbol!.endsWith(".BO") ? ("BSE" as const) : ("NSE" as const),
        name: x.longname ?? x.shortname ?? x.symbol!,
        type: x.quoteType === "ETF" ? ("etf" as const) : ("stock" as const),
        sector: x.sector,
      }));
  }

  // ---- Routes -------------------------------------------------------------

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "GET") return json({ ok: false, error: "method not allowed" }, 405);
    const q = url.searchParams;

    switch (url.pathname) {
      case "/api/health":
        return json({ ok: true, service: "kaasu-api", navCachedFor: nav?.day ?? null });

      case "/api/amfi/navs": {
        const codes = (q.get("codes") ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter((c) => /^\d{1,8}$/.test(c))
          .slice(0, MAX_CODES);
        try {
          const state = await loadNav(!!opts.allowForceRefresh && q.get("force") === "1");
          const navs: Record<string, { nav: number; date: string; name: string } | null> = {};
          for (const c of codes) {
            const s: AmfiScheme | null = state.index.get(c);
            navs[c] = s ? { nav: s.nav, date: s.date, name: s.name } : null;
          }
          return json({ ok: true, fetchedAt: state.fetchedAt, stale: state.stale, navs });
        } catch (e) {
          return json({ ok: false, error: `Could not fetch AMFI NAVs: ${(e as Error).message}` }, 502);
        }
      }

      case "/api/amfi/search": {
        const text = (q.get("q") ?? "").slice(0, 80);
        try {
          const state = await loadNav(false);
          return json({
            ok: true,
            results: state.index.search(text).map((s) => ({ code: s.code, name: s.name, nav: s.nav, date: s.date, category: s.category, fundHouse: s.fundHouse })),
          });
        } catch (e) {
          return json({ ok: false, error: (e as Error).message }, 502);
        }
      }

      case "/api/quote": {
        const items = (q.get("symbols") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^(NSE|BSE):[A-Za-z0-9&._-]{1,20}$/.test(s))
          .slice(0, MAX_QUOTES);
        const preferred: Provider = q.get("source") === "yahoo" ? "yahoo" : "google";
        const out: Record<string, Quote | { error: string }> = {};
        // Bounded concurrency: be polite to the quote sources and stay inside subrequest limits.
        const queue = [...items];
        await Promise.all(
          Array.from({ length: Math.min(6, queue.length) }, async () => {
            for (let it = queue.shift(); it !== undefined; it = queue.shift()) {
              const [ex, sym] = it.split(":") as [string, string];
              try {
                out[it] = await fetchQuote(ex, sym, preferred);
              } catch (e) {
                out[it] = { error: (e as Error).message };
              }
            }
          }),
        );
        return json({ ok: true, quotes: out });
      }

      case "/api/search": {
        const text = (q.get("q") ?? "").slice(0, 60);
        if (!text.trim()) return json({ ok: true, results: [] });
        try {
          // Exact query first; if it finds nothing, progressively looser variants.
          const seen = new Set<string>();
          const results: (SymbolResult & { matchedQuery: string })[] = [];
          for (const variant of searchVariants(text)) {
            for (const r of await yahooSearch(variant)) {
              const key = `${r.exchange}:${r.symbol}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ ...r, matchedQuery: variant });
            }
            if (results.length >= 4) break;
          }
          // NSE first: that's where Kaasu prices from by default.
          results.sort((a, b) => (a.exchange === b.exchange ? 0 : a.exchange === "NSE" ? -1 : 1));
          return json({ ok: true, results: results.slice(0, 12) });
        } catch (e) {
          return json({ ok: false, error: (e as Error).message }, 502);
        }
      }

      default:
        return json({ ok: false, error: "not found" }, 404);
    }
  };
}
