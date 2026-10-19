/**
 * Cloud sync is optional: without Supabase settings Kaasu runs fully local.
 * (The Supabase *anon / publishable* key is designed to be public. Row-level
 * security in the database is what protects data.)
 *
 * Names: VITE_SUPABASE_* (set by hand) or NEXT_PUBLIC_SUPABASE_* (injected by
 * Vercel's Supabase integration). See vite.config.ts for what is exposed.
 */
const env = import.meta.env;

export const SUPABASE_URL: string | undefined = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || undefined;
export const SUPABASE_KEY: string | undefined =
  env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined;
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
