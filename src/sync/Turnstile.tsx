import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile (a privacy-friendly CAPTCHA). The site key is public. Supabase verifies the
 * token server-side with the secret you give it, so skipping the widget is rejected there.
 */
export const TURNSTILE_SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY || undefined;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("The security check couldn't load. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Renders the challenge. Tokens are single-use: change `resetKey` after each attempt to get a fresh one. */
export function Turnstile({ onToken, onError, resetKey }: { onToken: (token: string | null) => void; onError?: (message: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef({ onToken, onError });
  cb.current = { onToken, onError };

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let id: string | undefined;
    let cancelled = false;
    cb.current.onToken(null);
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          callback: (t: string) => cb.current.onToken(t),
          "expired-callback": () => cb.current.onToken(null),
          "error-callback": () => cb.current.onError?.("The security check failed. Reload and try again."),
        });
      })
      .catch((e: Error) => cb.current.onError?.(e.message));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="min-h-[65px]" />;
}
