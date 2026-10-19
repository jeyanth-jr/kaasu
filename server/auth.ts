/**
 * Edge protection for the price API: Supabase JWT verification, CORS and a
 * small per-user rate limit. Pure web-standard code (jose runs on Workers).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthConfig {
  /** e.g. https://abcd1234.supabase.co */
  supabaseUrl: string;
  /** Legacy HS256 projects only. Leave unset for projects using asymmetric signing keys (JWKS). */
  jwtSecret?: string;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export interface Verified {
  sub: string;
  email?: string;
}

/** Returns the verified user, or null for a missing/invalid/expired token. */
export async function verifyBearer(req: Request, cfg: AuthConfig): Promise<Verified | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const base = cfg.supabaseUrl.replace(/\/+$/, "");
  try {
    const key = cfg.jwtSecret
      ? new TextEncoder().encode(cfg.jwtSecret)
      : (jwksCache.get(base) ?? (jwksCache.set(base, createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`))), jwksCache.get(base)!));
    const { payload } = await jwtVerify(m[1]!, key as never, {
      issuer: `${base}/auth/v1`,
      audience: "authenticated",
      algorithms: cfg.jwtSecret ? ["HS256"] : ["ES256", "RS256", "EdDSA"],
    });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS

export function parseOrigins(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Exact-match allow-list; `*.example.app` entries match any subdomain (Vercel previews). */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  return allowed.some((a) => {
    if (a === origin) return true;
    if (a.startsWith("*.")) {
      try {
        const u = new URL(origin);
        const root = a.slice(1); // ".example.app"
        return u.protocol === "https:" && u.hostname.endsWith(root) && u.hostname.length > root.length;
      } catch {
        return false;
      }
    }
    return false;
  });
}

export function withCors(res: Response, origin: string | null, allowed: string[]): Response {
  const h = new Headers(res.headers);
  h.append("vary", "Origin");
  if (originAllowed(origin, allowed)) {
    h.set("access-control-allow-origin", origin!);
    h.set("access-control-allow-headers", "authorization, content-type");
    h.set("access-control-allow-methods", "GET, OPTIONS");
    h.set("access-control-max-age", "86400");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// ---------------------------------------------------------------------------
// Rate limiting: best-effort per isolate. Pair with a Cloudflare rate-limiting rule for a hard limit.

export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    if (this.hits.size > 5000) this.hits.clear();
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    cur.n++;
    return cur.n <= this.limit;
  }
}
