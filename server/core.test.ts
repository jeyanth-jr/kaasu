import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { RateLimiter, originAllowed, parseOrigins, verifyBearer, withCors } from "./auth";
import { createApi, istDay, type NavStore } from "./core";

const NAV = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  "",
  "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
  "",
  "Example Mutual Fund",
  "",
  "900001;INF000000001;-;Example Flexi Cap Fund;Direct Plan;Growth Option;84.1234;16-Oct-2026",
  "900002;INF000000002;-;Example Flexi Cap Fund;Regular Plan;IDCW Option;31.5;16-Oct-2026",
].join("\n") + "\n" + "x".repeat(520_000); // padded: the validator rejects tiny files

function memoryStore(initial?: Record<string, string>): NavStore & { puts: string[] } {
  const m = new Map(Object.entries(initial ?? {}));
  const puts: string[] = [];
  return {
    puts,
    get: async (d) => m.get(d) ?? null,
    put: async (d, t) => {
      puts.push(d);
      m.set(d, t);
    },
    latest: async () => {
      const day = [...m.keys()].sort().at(-1);
      return day ? { day, text: m.get(day)! } : null;
    },
  };
}

const NOW = new Date("2026-10-19T06:00:00Z");
const GOOGLE_PAGE = `[["/g/1",["INFY","NSE"],"Infosys Ltd",0,"INR",[1143.9,-17.3,-1.49,2,2,2],null,1161.2,"#3c84c3","IN","/m/x",[1792386785]]]`;

function fakeFetch(routes: Record<string, () => Response>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return v();
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

const get = (path: string) => new Request(`https://api.test${path}`);

describe("price API core", () => {
  it("downloads the NAV file once per day and answers from the store afterwards", async () => {
    const store = memoryStore();
    const calls: string[] = [];
    const api = createApi({ navStore: store, now: () => NOW, fetchImpl: fakeFetch({ NAVAll: () => new Response(NAV) }, calls) });
    const a = await (await api(get("/api/amfi/navs?codes=900001,555,abc"))).json();
    expect(a.navs["900001"]).toEqual({ nav: 84.1234, date: "2026-10-16", name: "Example Flexi Cap Fund - Direct Plan - Growth Option" });
    expect(a.navs["555"]).toBeNull();
    expect("abc" in a.navs).toBe(false);
    await api(get("/api/amfi/navs?codes=900001"));
    expect(calls.filter((c) => c.includes("NAVAll"))).toHaveLength(1);
    expect(store.puts).toEqual(["2026-10-19"]);

    // A fresh instance (new isolate) reads the stored copy instead of downloading.
    const calls2: string[] = [];
    const api2 = createApi({ navStore: store, now: () => NOW, fetchImpl: fakeFetch({}, calls2) });
    expect((await (await api2(get("/api/amfi/navs?codes=900001"))).json()).navs["900001"].nav).toBe(84.1234);
    expect(calls2).toHaveLength(0);
  });

  it("serves yesterday's file flagged stale when AMFI is down, and 502s with nothing cached", async () => {
    const down = fakeFetch({ NAVAll: () => new Response("err", { status: 503 }) });
    const withOld = createApi({ navStore: memoryStore({ "2026-10-17": NAV }), now: () => NOW, fetchImpl: down });
    const r = await (await withOld(get("/api/amfi/navs?codes=900001"))).json();
    expect(r).toMatchObject({ ok: true, stale: true });
    expect(r.navs["900001"].nav).toBe(84.1234);

    const none = createApi({ navStore: memoryStore(), now: () => NOW, fetchImpl: down });
    const res = await none(get("/api/amfi/navs?codes=900001"));
    expect(res.status).toBe(502);
  });

  it("rejects a truncated AMFI download instead of caching it", async () => {
    const store = memoryStore();
    const api = createApi({ navStore: store, now: () => NOW, fetchImpl: fakeFetch({ NAVAll: () => new Response("Scheme Code;x\n1;2") }) });
    expect((await api(get("/api/amfi/navs?codes=1"))).status).toBe(502);
    expect(store.puts).toEqual([]);
  });

  it("searches schemes with Direct Growth first", async () => {
    const api = createApi({ navStore: memoryStore({ "2026-10-19": NAV }), now: () => NOW });
    const r = await (await api(get("/api/amfi/search?q=example%20flexi"))).json();
    expect(r.results.map((x: { code: string }) => x.code)).toEqual(["900001", "900002"]);
  });

  it("prices from Google first and falls back to Yahoo; caches for a minute", async () => {
    const calls: string[] = [];
    const yahoo = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 500, regularMarketTime: 1792386000, chartPreviousClose: 490, currency: "INR", longName: "Yahoo Co" } }] } });
    const api = createApi({
      navStore: memoryStore(),
      now: () => NOW,
      fetchImpl: fakeFetch(
        {
          "google.com/finance/quote/INFY:NSE": () => new Response(GOOGLE_PAGE),
          "google.com/finance/quote/OTHER:NSE": () => new Response("<html>no data</html>"),
          "finance/chart/OTHER.NS": () => new Response(yahoo),
        },
        calls,
      ),
    });
    const r = await (await api(get("/api/quote?symbols=NSE:INFY,NSE:OTHER,NSE:%3Cscript%3E"))).json();
    expect(r.quotes["NSE:INFY"]).toMatchObject({ provider: "google", price: 1143.9, prevClose: 1161.2 });
    expect(r.quotes["NSE:OTHER"]).toMatchObject({ provider: "yahoo", price: 500, prevClose: 490 });
    expect(Object.keys(r.quotes)).toEqual(["NSE:INFY", "NSE:OTHER"]); // malformed symbol was dropped
    const before = calls.length;
    await api(get("/api/quote?symbols=NSE:INFY"));
    expect(calls.length).toBe(before);
  });

  it("reports both reasons when no provider has the symbol", async () => {
    const api = createApi({ navStore: memoryStore(), now: () => NOW, fetchImpl: fakeFetch({ google: () => new Response("<html/>"), finance: () => new Response("{}", { status: 404 }) }) });
    const r = await (await api(get("/api/quote?symbols=NSE:NOPE"))).json();
    expect(r.quotes["NSE:NOPE"].error).toMatch(/google: .*; yahoo: /);
  });

  it("ignores ?force=1 unless explicitly allowed, and only serves GET", async () => {
    const calls: string[] = [];
    const store = memoryStore({ "2026-10-19": NAV });
    const api = createApi({ navStore: store, now: () => NOW, fetchImpl: fakeFetch({ NAVAll: () => new Response(NAV) }, calls) });
    await api(get("/api/amfi/navs?codes=900001&force=1"));
    expect(calls).toHaveLength(0);
    expect((await api(new Request("https://api.test/api/health", { method: "POST" }))).status).toBe(405);
    expect((await api(get("/api/unknown"))).status).toBe(404);
  });

  it("computes the IST calendar day", () => {
    expect(istDay(new Date("2026-10-19T19:00:00Z"))).toBe("2026-10-20"); // 00:30 IST next day
  });
});

describe("auth, CORS and rate limiting", () => {
  const secret = "test-secret-test-secret-test-secret-1234";
  const cfg = { supabaseUrl: "https://abc.supabase.co", jwtSecret: secret };
  const sign = (claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT({ email: "a@b.c", ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setAudience(opts.aud ?? "authenticated")
      .setIssuer(opts.iss ?? "https://abc.supabase.co/auth/v1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(new TextEncoder().encode(secret));
  const reqWith = (token?: string) => new Request("https://api.test/api/quote", { headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("accepts a valid Supabase token and rejects missing, expired, wrong-audience and forged ones", async () => {
    expect(await verifyBearer(reqWith(await sign()), cfg)).toEqual({ sub: "user-1", email: "a@b.c" });
    expect(await verifyBearer(reqWith(), cfg)).toBeNull();
    expect(await verifyBearer(reqWith("not.a.jwt"), cfg)).toBeNull();
    expect(await verifyBearer(reqWith(await sign({}, { exp: "-1m" })), cfg)).toBeNull();
    expect(await verifyBearer(reqWith(await sign({}, { aud: "anon" })), cfg)).toBeNull();
    expect(await verifyBearer(reqWith(await sign({}, { iss: "https://evil.example/auth/v1" })), cfg)).toBeNull();
    const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("x").setAudience("authenticated").setIssuer("https://abc.supabase.co/auth/v1").setExpirationTime("1h").sign(new TextEncoder().encode("a-different-secret-a-different-secret!!"));
    expect(await verifyBearer(reqWith(forged), cfg)).toBeNull();
  });

  it("allows only listed origins, with wildcard subdomains for previews", () => {
    const allowed = parseOrigins("https://kaasu.vercel.app/, *.kaasu-preview.vercel.app,http://localhost:5173");
    expect(originAllowed("https://kaasu.vercel.app", allowed)).toBe(true);
    expect(originAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(originAllowed("https://pr-12.kaasu-preview.vercel.app", allowed)).toBe(true);
    expect(originAllowed("https://kaasu-preview.vercel.app", allowed)).toBe(false);
    expect(originAllowed("https://evil.com", allowed)).toBe(false);
    expect(originAllowed("https://x.kaasu-preview.vercel.app.evil.com", allowed)).toBe(false);
    expect(originAllowed("http://pr.kaasu-preview.vercel.app", allowed)).toBe(false); // https only
    expect(originAllowed(null, allowed)).toBe(false);
  });

  it("adds CORS headers only for allowed origins", () => {
    const ok = withCors(new Response("x"), "https://kaasu.vercel.app", ["https://kaasu.vercel.app"]);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://kaasu.vercel.app");
    expect(ok.headers.get("vary")).toContain("Origin");
    const no = withCors(new Response("x"), "https://evil.com", ["https://kaasu.vercel.app"]);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("limits requests per user within a window", () => {
    const rl = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow("u", 0))).toEqual([true, true, true, false]);
    expect(rl.allow("other", 0)).toBe(true);
    expect(rl.allow("u", 1500)).toBe(true);
  });
});
