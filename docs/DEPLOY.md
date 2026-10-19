# Deploying Kaasu

Three pieces, each independent:

| Piece | Host | What it does |
| --- | --- | --- |
| Web app | **Vercel** | The static React app. Your data lives in each browser (IndexedDB). |
| Price API | **Cloudflare Worker** | Fetches AMFI NAVs and Google/Yahoo quotes. Requires a signed-in user. |
| Accounts + cloud copy | **Supabase** | Login, and a private per-user database for sync/backup. |

Kaasu is **local-first**: it works with none of this configured. The Worker and Supabase add sign-in, multi-device sync and live prices in production. Do them in this order, because each step produces a value the next one needs.

You need free accounts on all three. I couldn't create them or deploy for you: each requires you to log in.

---

## 1. Supabase (accounts and database)

1. Create a project at supabase.com. Note the **Project URL** and the **anon / publishable key** (Project Settings → API). Never use the `service_role` key anywhere in this repo.
2. **SQL editor → New query**, paste the whole of [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql), and run it. It creates the `records` table with row-level security (each user can only touch their own rows), a server-assigned sync cursor, and a `delete_my_account()` function. (Or use the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → URL Configuration**:
   - Site URL: your Vercel URL, e.g. `https://kaasu.vercel.app`
   - Redirect URLs: add `https://kaasu.vercel.app/**` and `http://localhost:5173/**`. Add preview URLs too if you use them.
4. **Authentication → Emails**: the built-in sender is limited to a handful of emails per hour. For real use, add your own SMTP (Resend, Postmark, SES…). Optionally add `{{ .Token }}` to the *Magic Link* template so users can type a 6-digit code instead of clicking a link (handy on phones where the link opens another browser).
5. Optional **Google sign-in**: Authentication → Providers → Google, with an OAuth client from Google Cloud Console. Add the callback URL Supabase shows you.
6. **Project Settings → JWT Keys**: new projects sign tokens with asymmetric keys, and the Worker verifies them through the project's public JWKS automatically. If your project is on the legacy shared secret (HS256), set `SUPABASE_JWT_SECRET` on the Worker in step 2.

## 2. Cloudflare Worker (price API)

The Worker name in [`wrangler.toml`](../wrangler.toml) is `kaasu` (your URL will be `https://kaasu.<your-subdomain>.workers.dev`).

**Connected to GitHub (Workers Builds, recommended):** in the Cloudflare dashboard, Workers & Pages → Create → import the repo. Leave the build command empty and keep the deploy command `npx wrangler deploy`. Then, once, open the Worker → **Settings → Variables and Secrets** and add:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | your Supabase Project URL, e.g. `https://abcd1234.supabase.co` |
| `ALLOWED_ORIGINS` | your Vercel origin(s), comma-separated, e.g. `https://kaasu.vercel.app`. `*.vercel.app` also matches preview deployments (https only). Anything not listed gets a 403. |
| `SUPABASE_JWT_SECRET` (secret) | only for legacy HS256 Supabase projects |

`keep_vars = true` in `wrangler.toml` makes deploys leave these dashboard values alone. Without `SUPABASE_URL` the Worker answers 503 "API not configured", and without `ALLOWED_ORIGINS` browsers get 403.

**From your terminal instead:** `npx wrangler login`, then `npx wrangler deploy`, then set the same variables in the dashboard.

**Optional KV cache** for the daily AMFI file (so each new Worker instance doesn't re-download it): `npx wrangler kv namespace create NAV_KV`, then uncomment the `[[kv_namespaces]]` block in `wrangler.toml` with the printed id. Never commit the placeholder id: Cloudflare rejects deploys with an invalid namespace id.

Check it: open `https://kaasu.<you>.workers.dev/api/health`, which should return `{"ok":true,...}`. Every other route returns 401 without a signed-in user's token.

What the Worker enforces: allowed origins only; a valid, unexpired Supabase token (audience `authenticated`, issuer your project) on every route except `/api/health`; a per-user limit of 120 requests/minute per isolate; GET only. For a hard limit, also add a **Cloudflare rate-limiting rule** on the route in the dashboard.

> **CPU budget:** the Worker parses only the lines it needs from the 1.5 MB AMFI file (about 8 ms for a fund lookup plus a search on a desktop-class CPU). The Workers **Free** plan allows about 10 ms CPU per request, which is tight for the first request on a new instance, so the **Paid plan ($5/month)** is the safe choice. I measured the lookup in Node and ran the Worker locally in `wrangler dev`, but have not measured it on Cloudflare's edge.

## 3. Vercel (web app)

Import the GitHub repo in Vercel (or `npx vercel` from this folder). The framework preset is picked up from [`vercel.json`](../vercel.json).

**Vercel's "Optional Integrations → Supabase" prompt** is a convenience, not a requirement. If you add it, Vercel links a Supabase project and injects `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which Kaasu reads automatically (so you can skip those two variables below). It does **not** run the database migration: you still run `supabase/migrations/0001_init.sql` in that project (step 1.2). The integration also adds server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, Postgres URLs). Kaasu never uses them and they are not exposed to the browser bundle, but you can remove them from Vercel if you want a smaller blast radius.

Set these **environment variables** (Production, and Preview if you want them):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `VITE_API_BASE` | Worker URL from step 2, no trailing slash, e.g. `https://kaasu.<you>.workers.dev` |

Environment variables are baked in at build time, so **redeploy after changing them**.

Deploy. Then make sure the final Vercel URL is in Supabase's redirect URLs (step 1.3) and in the Worker's `ALLOWED_ORIGINS` (step 2). If you add a custom domain later, add it to both and to the `connect-src` entry in `vercel.json` only if the API is on a custom domain (workers.dev and supabase.co are already allowed).

`vercel.json` also sets a strict **Content-Security-Policy** (no inline scripts, connections only to this site, Supabase and workers.dev), HSTS, `X-Frame-Options: DENY`, a locked-down Permissions-Policy, and long-lived caching for hashed assets only.

### Check it worked

1. Open the app, click the cloud icon, sign in with your email.
2. Settings → Account shows "Synced". Add a spend, open the app in a second browser, sign in: it appears.
3. Click the refresh-prices button. With no sign-in you get "Sign in to fetch live prices"; signed in, prices update.

---

## Local development

```bash
cp .env.example .env.local     # leave empty to stay fully local
npm run dev                    # app on :5173, price API on :8787
```

To test the Worker locally: `npm run cf:dev` (uses a local KV simulation).

## Security model

- **Authentication:** Supabase Auth (email link/code, optional Google). Sessions use PKCE.
- **Authorisation:** Postgres row-level security on every operation, forced for table owners too. Tests in `supabase/schema.test.ts` run the migration on a real Postgres and check that users can't read, write, move or delete each other's rows, that anonymous access is refused, and that clients can't forge the sync cursor.
- **Encryption:** TLS in transit; encrypted at rest by Supabase. Data is stored as normal rows, **not end-to-end encrypted**, so Supabase (and anyone with database access) can read it. Local backups can be passphrase-encrypted (AES-256-GCM) from Settings. If you want zero-knowledge cloud storage later, the sync layer is a single place to add client-side encryption.
- **Local data:** stays on the device in IndexedDB. Signing in to a *different* account on a device that holds another account's data asks before removing it. "Sign out and clear this device" wipes it.
- **Account deletion:** Settings → Account → Danger zone → *Delete account* removes the login and every cloud record. *Erase cloud copy* removes the records and disconnects the device.
- **Sample data** never syncs.

## How sync behaves

- Local changes are written to an outbox and pushed a couple of seconds later, on reconnect, when the tab becomes visible and every minute.
- Conflicts are **last write wins per record**: if the same record is edited on two devices before either syncs, the later push wins. Fine for one person; not a collaboration tool.
- Deletions sync as tombstones. Restoring a backup syncs as a replacement.
- There is no live push: other devices pick up changes within about a minute or when you switch back to the tab.

## Operating notes

- Supabase's free tier pauses projects after a week of inactivity; the app keeps working locally and syncs when the project is resumed.
- The Google and Yahoo quote sources are unofficial. If both break, enter prices manually. Mutual fund NAVs come from AMFI.
- Back up regularly anyway (Settings → Backup): sync is a copy, not a time machine. A bad edit syncs everywhere.
