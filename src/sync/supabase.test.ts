import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabaseRemote } from "./supabase";

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
}

function client(reply: (req: Seen) => Response) {
  const seen: Seen[] = [];
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const s: Seen = { method: req.method, url: new URL(req.url), headers: req.headers, body: init?.body ? String(init.body) : null };
    seen.push(s);
    return reply(s);
  }) as typeof fetch;
  const c = createClient("https://abc.supabase.co", "sb_publishable_test", { global: { fetch: fetchMock }, auth: { persistSession: false, autoRefreshToken: false } });
  return { c, seen };
}

describe("Supabase adapter speaks PostgREST correctly", () => {
  it("pushes rows as an upsert on (user_id, collection, id), in chunks", async () => {
    const { c, seen } = client(() => new Response(null, { status: 201 }));
    const rows = Array.from({ length: 450 }, (_, i) => ({ collection: "txns", id: `t${i}`, data: { amount: i }, deleted: false }));
    rows.push({ collection: "txns", id: "gone", data: null as never, deleted: true });
    await supabaseRemote(c, "user-1").push(rows);
    expect(seen).toHaveLength(3); // 451 rows → 200 + 200 + 51
    const first = seen[0]!;
    expect(first.method).toBe("POST");
    expect(first.url.pathname).toBe("/rest/v1/records");
    expect(first.url.searchParams.get("on_conflict")).toBe("user_id,collection,id");
    expect(first.headers.get("prefer")).toContain("resolution=merge-duplicates");
    expect(first.headers.get("apikey")).toBe("sb_publishable_test");
    const body = JSON.parse(first.body!);
    expect(body[0]).toEqual({ user_id: "user-1", collection: "txns", id: "t0", data: { amount: 0 }, deleted: false });
    const last = JSON.parse(seen[2]!.body!);
    expect(last.at(-1)).toEqual({ user_id: "user-1", collection: "txns", id: "gone", data: null, deleted: true });
  });

  it("pulls changes after a cursor, ordered by seq, and maps the rows", async () => {
    const { c, seen } = client(
      () =>
        new Response(JSON.stringify([{ collection: "cash", id: "c1", data: { amount: 5 }, deleted: false, seq: "42" }, { collection: "cash", id: "c2", data: null, deleted: true, seq: 43 }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const rows = await supabaseRemote(c, "user-1").pull(41, 1000);
    const u = seen[0]!.url;
    expect(seen[0]!.method).toBe("GET");
    expect(u.pathname).toBe("/rest/v1/records");
    expect(u.searchParams.get("seq")).toBe("gt.41");
    expect(u.searchParams.get("order")).toBe("seq.asc");
    expect(u.searchParams.get("limit")).toBe("1000");
    expect(u.searchParams.get("select")).toBe("collection,id,data,deleted,seq");
    expect(rows).toEqual([
      { collection: "cash", id: "c1", data: { amount: 5 }, deleted: false, seq: 42 }, // bigint arrives as a string; normalised to a number
      { collection: "cash", id: "c2", data: null, deleted: true, seq: 43 },
    ]);
  });

  it("surfaces database errors instead of swallowing them", async () => {
    const err = () => new Response(JSON.stringify({ message: "new row violates row-level security policy", code: "42501" }), { status: 403, headers: { "content-type": "application/json" } });
    const { c } = client(err);
    await expect(supabaseRemote(c, "u").push([{ collection: "txns", id: "x", data: {}, deleted: false }])).rejects.toThrow(/row-level security/);
    await expect(supabaseRemote(c, "u").pull(0, 10)).rejects.toThrow(/row-level security/);
  });
});
