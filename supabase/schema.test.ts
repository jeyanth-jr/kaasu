import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real migration on an in-process Postgres and checks the security
 * rules. Supabase's `auth` schema and roles are stubbed the way Supabase
 * provides them (auth.uid() reads the JWT subject from a session setting).
 */
const migration = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url), "utf8");
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

let db: PGlite;

async function as(user: string | null, fn: () => Promise<unknown>) {
  await db.exec(`reset role; ${user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);` : "set role anon;"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

const upsert = (user: string, collection: string, id: string, data: unknown | null, deleted = false) =>
  db.query(
    `insert into public.records (user_id, collection, id, data, deleted) values ($1, $2, $3, $4::jsonb, $5)
     on conflict (user_id, collection, id) do update set data = excluded.data, deleted = excluded.deleted
     returning seq`,
    [user, collection, id, data === null ? null : JSON.stringify(data), deleted],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant select, delete on auth.users to authenticated; -- stands in for the dashboard's service access
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await db.exec(migration);
  // delete_my_account runs as its (privileged) owner, not as the caller.
});

describe("records table: row-level security", () => {
  it("lets a user write and read only their own rows", async () => {
    await as(A, () => upsert(A, "txns", "t1", { amount: 100 }));
    await as(B, () => upsert(B, "txns", "t1", { amount: 999 })); // same id, different user: no clash
    const mine = (await as(A, () => db.query("select collection, id, data from public.records"))) as { rows: { data: { amount: number } }[] };
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]!.data.amount).toBe(100);
    const theirs = (await as(B, () => db.query("select data from public.records"))) as { rows: { data: { amount: number } }[] };
    expect(theirs.rows.map((r) => r.data.amount)).toEqual([999]);
  });

  it("refuses to insert, update or delete on someone else's behalf", async () => {
    await expect(as(A, () => upsert(B, "txns", "evil", { x: 1 }))).rejects.toThrow(/row-level security/);
    // Update/delete of B's rows silently match nothing for A.
    const upd = (await as(A, () => db.query(`update public.records set data = '{"hacked":true}' where user_id = '${B}' returning id`))) as { rows: unknown[] };
    expect(upd.rows).toHaveLength(0);
    const del = (await as(A, () => db.query(`delete from public.records where user_id = '${B}' returning id`))) as { rows: unknown[] };
    expect(del.rows).toHaveLength(0);
    // Moving a row to another user is blocked too.
    await expect(as(A, () => db.query(`update public.records set user_id = '${B}' where user_id = '${A}'`))).rejects.toThrow(/row-level security/);
  });

  it("is unreachable without signing in", async () => {
    await expect(as(null, () => db.query("select * from public.records"))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => db.query("insert into public.records (user_id, collection, id, data) values (default, 'a', 'b', '{}')"))).rejects.toThrow(/permission denied/);
  });

  it("assigns a strictly increasing seq on every insert and update, ignoring client values", async () => {
    const a = (await as(A, () => upsert(A, "cash", "c1", { n: 1 }))) as { rows: { seq: string }[] };
    const b = (await as(A, () => upsert(A, "cash", "c2", { n: 1 }))) as { rows: { seq: string }[] };
    const c = (await as(A, () => upsert(A, "cash", "c1", { n: 2 }))) as { rows: { seq: string }[] };
    const [s1, s2, s3] = [a, b, c].map((r) => Number(r.rows[0]!.seq));
    expect(s2!).toBeGreaterThan(s1!);
    expect(s3!).toBeGreaterThan(s2!);
    // A client cannot choose its own seq (the trigger overwrites it).
    const forged = (await as(A, () => db.query(`insert into public.records (collection, id, data, seq) values ('cash', 'c3', '{}', 0) returning seq`))) as { rows: { seq: string }[] };
    expect(Number(forged.rows[0]!.seq)).toBeGreaterThan(s3!);
  });

  it("stores tombstones without data and rejects malformed rows", async () => {
    await as(A, () => upsert(A, "cash", "gone", null, true));
    await expect(as(A, () => upsert(A, "cash", "bad1", null, false))).rejects.toThrow(/records_shape/);
    await expect(as(A, () => upsert(A, "cash", "bad2", { x: 1 }, true))).rejects.toThrow(/records_shape/);
    await expect(as(A, () => upsert(A, "bad collection!", "x", {}))).rejects.toThrow(/check constraint/);
    await expect(as(A, () => upsert(A, "cash", "x".repeat(201), {}))).rejects.toThrow(/check constraint/);
    await expect(as(A, () => upsert(A, "cash", "huge", { blob: "x".repeat(300_000) }))).rejects.toThrow(/records_shape/);
  });

  it("pulls only my changes after a cursor, oldest first", async () => {
    const cursor = ((await as(A, () => db.query("select max(seq) as m from public.records"))) as { rows: { m: string }[] }).rows[0]!.m;
    await as(B, () => upsert(B, "cash", "b-new", { z: 1 }));
    await as(A, () => upsert(A, "cash", "a-new", { z: 1 }));
    const pulled = (await as(A, () => db.query("select id from public.records where seq > $1 order by seq asc", [cursor]))) as { rows: { id: string }[] };
    expect(pulled.rows.map((r) => r.id)).toEqual(["a-new"]);
  });
});

describe("delete_my_account", () => {
  it("removes the login and every record for that user only", async () => {
    await as(B, () => db.query("select public.delete_my_account()"));
    const users = await db.query<{ id: string }>("select id from auth.users");
    expect(users.rows.map((r) => r.id)).toEqual([A]);
    const left = await db.query<{ user_id: string }>("select distinct user_id from public.records");
    expect(left.rows.map((r) => r.user_id)).toEqual([A]);
  });

  it("refuses when not signed in", async () => {
    await expect(as(null, () => db.query("select public.delete_my_account()"))).rejects.toThrow(/permission denied/);
  });
});
