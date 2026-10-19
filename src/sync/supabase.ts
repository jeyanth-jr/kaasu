import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, syncConfigured } from "./config";
import type { RemoteRow, RemoteStore, RemoteWrite } from "./engine";

export const supabase: SupabaseClient | null = syncConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: {
        // PKCE returns ?code=… in the query string, which coexists with the hash router
        // (the implicit flow would put tokens in the URL hash and fight it).
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "kaasu.auth",
      },
    })
  : null;

const PUSH_CHUNK = 200;

/** The user's `records` table as a RemoteStore. Row-level security scopes every query to them. */
export function supabaseRemote(client: SupabaseClient, userId: string): RemoteStore {
  return {
    async push(rows: RemoteWrite[]) {
      for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
        const chunk = rows.slice(i, i + PUSH_CHUNK).map((r) => ({ user_id: userId, collection: r.collection, id: r.id, data: r.data, deleted: r.deleted }));
        const { error } = await client.from("records").upsert(chunk, { onConflict: "user_id,collection,id" });
        if (error) throw new Error(error.message);
      }
    },
    async pull(afterSeq: number, limit: number): Promise<RemoteRow[]> {
      const { data, error } = await client.from("records").select("collection,id,data,deleted,seq").gt("seq", afterSeq).order("seq", { ascending: true }).limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ collection: r.collection as string, id: r.id as string, data: r.data, deleted: !!r.deleted, seq: Number(r.seq) }));
    },
  };
}
