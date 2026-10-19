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

```bash
npx wrangler login
npx wrangler kv namespace create NAV_KV     # prints an id
```

Edit [`wrangler.toml`](../wrangler.toml):

- `SUPABASE_URL`: your Project URL
- `ALLOWED_ORIGINS`: your Vercel origin(s), comma-separated. `*.vercel.app` style wildcards match preview deployments (https only). Anything not listed gets a 403.
- `[[kv_namespaces]] id`: the id printed above

Then:

```bash
npx wrangler deploy
# Only for legacy HS256 Supabase projects:
npx wrangler secret put SUPABASE_JWT_SECRET
```

Note the URL it prints, e.g. `https://kaasu-api.<you>.workers.dev`.

What the Worker enforces: allowed origins only; a valid, unexpired Supabase token (audience `authenticated`, issuer your project) on every route except `/api/health`; a per-user limit of 120 requests/minute per isolate; GET only. For a hard limit, also add a **Cloudflare rate-limiting rule** on the route in the dashboard.

> **CPU budget:** the Worker parses only the lines it needs from the 1.5 MB AMFI file (about 8 ms for a fund lookup plus a search on a desktop-class CPU) and keeps each day's file in KV. The Workers **Free** plan allows about 10 ms CPU per request, which is tight for the first request of a new day, so the **Paid plan ($5/month)** is the safe choice. I measured the lookup in Node and ran the Worker locally in `wrangler dev`, but have not measured it on Cloudflare's edge.

## 3. Vercel (web app)

Import the GitHub repo in Vercel (or `npx vercel` from this folder). The framework preset is picked up from [`vercel.json`](../vercel.json). Set these **environment variables** (Production, and Preview if you want them):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `VITE_API_BASE` | Worker URL from step 2, no trailing slash |

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
