/**
 * Cloudflare Worker entry: Kaasu price API behind Supabase auth.
 *
 * Request flow: CORS preflight → origin allow-list → Supabase JWT → per-user
 * rate limit → shared handler (server/core.ts). The day's AMFI NAV file is
 * kept in KV so the 1.5 MB download happens at most once a day.
 */
import { RateLimiter, originAllowed, parseOrigins, verifyBearer, withCors } from "../server/auth";
import { createApi, istDay, type NavStore } from "../server/core";

/** Cloudflare's Workers Rate Limiting binding (shared across every instance, unlike the in-memory fallback). */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  /** Optional rate-limit binding, see wrangler.toml. */
  RATE_LIMITER?: RateLimitBinding;
  /** KV namespace for the daily NAV file (optional: falls back to per-isolate memory). */
  NAV_KV?: KVNamespace;
  SUPABASE_URL?: string;
  /** Only for legacy HS256 Supabase projects. */
  SUPABASE_JWT_SECRET?: string;
  /** Comma-separated origins allowed to call the API, e.g. https://kaasu.vercel.app,*.vercel.app */
  ALLOWED_ORIGINS: string;
  /** "false" turns auth off (local `wrangler dev` only). */
  AUTH_REQUIRED?: string;
}

const NAV_TTL_SECONDS = 60 * 60 * 24 * 8;

function kvStore(kv: KVNamespace | undefined): NavStore {
  const mem = new Map<string, string>();
  return {
    async get(day) {
      return mem.get(day) ?? (kv ? await kv.get(`navall:${day}`) : null);
    },
    async put(day, text) {
      mem.clear();
      mem.set(day, text);
      if (kv) {
        await kv.put(`navall:${day}`, text, { expirationTtl: NAV_TTL_SECONDS });
        await kv.put("navall:latest-day", day, { expirationTtl: NAV_TTL_SECONDS });
      }
    },
    async latest() {
      const memDay = [...mem.keys()].sort().at(-1);
      if (memDay) return { day: memDay, text: mem.get(memDay)! };
      if (!kv) return null;
      const day = await kv.get("navall:latest-day");
      const text = day ? await kv.get(`navall:${day}`) : null;
      return day && text ? { day, text } : null;
    },
  };
}

// One handler per isolate so the in-memory NAV index and quote cache are reused across requests.
let api: ReturnType<typeof createApi> | null = null;
const limiter = new RateLimiter(120, 60_000);
const ipLimiter = new RateLimiter(600, 60_000);

/** True when the request may proceed. Uses the shared binding when configured, else this instance's memory. */
async function allow(env: Env, key: string, fallback: RateLimiter): Promise<boolean> {
  if (env.RATE_LIMITER) {
    try {
      return (await env.RATE_LIMITER.limit({ key })).success;
    } catch {
      /* binding unavailable: fall through to the local limiter */
    }
  }
  return fallback.allow(key);
}

const tooMany = (origin: string | null, allowed: ReturnType<typeof parseOrigins>) =>
  withCors(new Response(JSON.stringify({ ok: false, error: "slow down: too many requests" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }), origin, allowed);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);
    const origin = req.headers.get("origin");

    if (req.method === "OPTIONS") {
      return originAllowed(origin, allowed) ? withCors(new Response(null, { status: 204 }), origin, allowed) : new Response(null, { status: 403 });
    }

    // Browsers send an Origin on cross-site calls; reject disallowed ones outright.
    if (origin && !originAllowed(origin, allowed)) {
      return new Response(JSON.stringify({ ok: false, error: "origin not allowed" }), { status: 403, headers: { "content-type": "application/json" } });
    }

    const path = new URL(req.url).pathname;
    const open = path === "/api/health";
    // Throttle by address before doing any token verification, so unauthenticated floods stay cheap.
    if (!open && !(await allow(env, `ip:${req.headers.get("cf-connecting-ip") ?? "unknown"}`, ipLimiter))) return tooMany(origin, allowed);
    let subject = "anonymous";
    if (!open && env.AUTH_REQUIRED !== "false") {
      if (!env.SUPABASE_URL) {
        return withCors(new Response(JSON.stringify({ ok: false, error: "API not configured: set SUPABASE_URL in the Worker's variables" }), { status: 503, headers: { "content-type": "application/json" } }), origin, allowed);
      }
      const user = await verifyBearer(req, { supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET });
      if (!user) return withCors(new Response(JSON.stringify({ ok: false, error: "sign in required" }), { status: 401, headers: { "content-type": "application/json" } }), origin, allowed);
      subject = user.sub;
    }
    if (!open && !(await allow(env, `user:${subject}`, limiter))) return tooMany(origin, allowed);

    api ??= createApi({ navStore: kvStore(env.NAV_KV), allowForceRefresh: false });
    return withCors(await api(req), origin, allowed);
  },
} satisfies ExportedHandler<Env>;

export { istDay };
