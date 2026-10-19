/**
 * Calls to the price API. In development it is the local proxy behind Vite's
 * /api; in production it is the Cloudflare Worker (VITE_API_BASE), which
 * requires the signed-in user's Supabase token.
 */
let tokenProvider: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: (() => Promise<string | null>) | null): void {
  tokenProvider = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// A bare host (no scheme) would otherwise resolve as a path on the current site.
const rawBase = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/+$/, "");
const base = rawBase && !/^(https?:)?\/\//i.test(rawBase) && !rawBase.startsWith("/") ? `https://${rawBase}` : rawBase;

export async function apiGet<T>(path: string, timeoutMs = 35_000): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await tokenProvider?.().catch(() => null);
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !body) throw new ApiError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`, res.status);
  return body;
}
