/**
 * Local price API for development: the same handler as the Cloudflare Worker,
 * served over node:http on localhost, with the NAV file cached on disk.
 * Run with `npm run proxy` (or via `npm run dev`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, type NavStore } from "./core";

const PORT = Number(process.env.KAASU_PROXY_PORT ?? 8787);
const HOST = process.env.KAASU_PROXY_HOST ?? "127.0.0.1";
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".cache");

const fileStore: NavStore = {
  async get(day) {
    try {
      return await readFile(join(CACHE_DIR, `navall-${day}.txt`), "utf8");
    } catch {
      return null;
    }
  },
  async put(day, text) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `navall-${day}.txt`), text, "utf8");
  },
  async latest() {
    try {
      const files = (await readdir(CACHE_DIR)).filter((f) => /^navall-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort();
      const last = files.at(-1);
      return last ? { day: last.slice(7, 17), text: await readFile(join(CACHE_DIR, last), "utf8") } : null;
    } catch {
      return null;
    }
  },
};

const api = createApi({ navStore: fileStore, allowForceRefresh: true });

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(`http://${req.headers.host ?? `${HOST}:${PORT}`}${req.url ?? "/"}`, { method: req.method, headers });
}

async function send(res: ServerResponse, r: Response): Promise<void> {
  res.statusCode = r.status;
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await r.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    await send(res, await api(await toRequest(req)));
  } catch (e) {
    await send(res, new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json" } }));
  }
}).listen(PORT, HOST, () => {
  console.log(`Kaasu price API on http://${HOST}:${PORT}`);
});
