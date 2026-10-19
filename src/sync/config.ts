/**
 * Cloud sync is optional: without Supabase settings Kaasu runs fully local.
 * (The Supabase *anon / publishable* key is designed to be public. Row-level
 * security in the database is what protects data.)
 */
export const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL || undefined;
export const SUPABASE_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || undefined;
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
