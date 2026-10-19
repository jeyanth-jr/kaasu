import { useEffect, useMemo, useState } from "react";
import { db } from "../db/db";
import { searchKnownSymbols } from "../data/symbols";
import { formatPrice } from "../domain/money";
import type { Holding } from "../domain/portfolio";
import type { Instrument, InstrumentKind } from "../domain/types";
import { KIND_LABEL } from "../domain/types";
import { priceLink, proxyOnline, refreshPrices, searchSchemes, searchSymbols, type SchemeHit, type SymbolHit } from "../prices/client";
import { classifyScheme } from "./AddTransaction";
import { Badge, Button, Callout, Input, Select, Sheet, cx } from "./components";
import { useData } from "./data";
import { blankDetails } from "./InstrumentForm";

/**
 * Open holdings that should get web prices but don't: no symbol / AMFI code,
 * or one that has never returned a price (e.g. a delisted or renamed symbol).
 */
export function useUnlinked(): Instrument[] {
  const { instruments, prices, portfolio } = useData();
  return useMemo(() => {
    const priced = new Set(prices.map((p) => p.instrumentId));
    const open = new Set(portfolio.holdings.filter((h) => !h.closed && h.qty > 0).map((h) => h.instrument.id));
    return instruments.filter((i) => {
      if (i.archived || i.sample) return false;
      const link = priceLink(i);
      return link === "missing" || (link === "web" && open.has(i.id) && !priced.has(i.id));
    });
  }, [instruments, prices, portfolio]);
}

function currentId(i: Instrument): string | null {
  const d = i.details;
  if (d.kind === "mf") return d.amfiCode ? `AMFI ${d.amfiCode}` : null;
  if (d.kind === "stock" || d.kind === "etf" || d.kind === "gold") return d.symbol ? `${d.exchange ?? "NSE"}: ${d.symbol}` : null;
  return null;
}

type Candidate =
  | { type: "scheme"; hit: SchemeHit }
  | { type: "symbol"; symbol: string; exchange: "NSE" | "BSE"; name: string; sector?: string; isEtf: boolean; gold: boolean };

export function LinkPricesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const unlinked = useUnlinked();
  const { portfolio } = useData();
  const [online, setOnline] = useState<boolean | null>(null);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Keep rows on screen after they are linked, so the list doesn't jump.
  const [rows, setRows] = useState<Instrument[]>([]);
  useEffect(() => {
    if (open) {
      setRows(unlinked);
      setLinked({});
      setRefreshMsg(null);
      void proxyOnline().then(setOnline);
    }
  }, [open]);

  const holdingOf = useMemo(() => new Map(portfolio.holdings.map((h) => [h.instrument.id, h])), [portfolio]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Link price sources"
      footer={
        <>
          {refreshMsg && <span className="mr-auto self-center text-xs text-muted">{refreshMsg}</span>}
          <Button
            variant="primary"
            disabled={busy || Object.keys(linked).length === 0}
            onClick={async () => {
              setBusy(true);
              const r = await refreshPrices();
              setRefreshMsg(r.message);
              setBusy(false);
            }}
          >
            {busy ? "Refreshing…" : `Refresh prices${Object.keys(linked).length ? ` (${Object.keys(linked).length} linked)` : ""}`}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        These holdings have no NSE/BSE symbol or AMFI scheme code, or the one they have never returned a price (renamed or delisted symbols, like Tata Motors after its demerger). Pick the right match for each. Compare the current price with your average cost to make sure it's the same security, and for funds the same plan (Direct vs Regular, Growth vs IDCW).
      </p>
      {online === false && (
        <div className="mb-3">
          <Callout tone="warn">The price proxy isn't running, so only the built-in stock list can be searched. Start it with npm run dev.</Callout>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">✓ Every holding has a price source.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((inst) => (
            <LinkRow key={inst.id} inst={inst} holding={holdingOf.get(inst.id)} online={!!online} linkedAs={linked[inst.id]} onLinked={(label) => setLinked((l) => ({ ...l, [inst.id]: label }))} />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function cleanQuery(name: string): string {
  return name
    .replace(/\s+-\s+(direct|regular).*$/i, " $1")
    .replace(/\b(ltd|limited)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function LinkRow({ inst, holding, online, linkedAs, onLinked }: { inst: Instrument; holding?: Holding; online: boolean; linkedAs?: string; onLinked: (label: string) => void }) {
  const [kind, setKind] = useState<InstrumentKind>(inst.kind);
  const [q, setQ] = useState(cleanQuery(inst.name));
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isFund = kind === "mf";
  const avg = holding && holding.qty > 0 ? holding.invested / 100 / holding.qty : null;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setCands([]);
    let alive = true;
    setCands(null);
    setError(null);
    const t = setTimeout(async () => {
      try {
        let out: Candidate[] = [];
        if (isFund) {
          if (online) out = (await searchSchemes(term)).slice(0, 8).map((hit) => ({ type: "scheme" as const, hit }));
        } else {
          const known = searchKnownSymbols(term, 4).map((k) => ({ type: "symbol" as const, symbol: k.symbol, exchange: "NSE" as const, name: k.name, sector: k.sector, isEtf: k.type === "etf", gold: !!k.gold }));
          let live: SymbolHit[] = [];
          if (online) live = await searchSymbols(term).catch(() => []);
          const seen = new Set(known.map((k) => `NSE:${k.symbol}`));
          out = [
            ...known,
            ...live
              .filter((h) => !seen.has(`${h.exchange}:${h.symbol}`))
              .slice(0, 6)
              .map((h) => ({ type: "symbol" as const, symbol: h.symbol, exchange: h.exchange, name: h.name, sector: h.sector, isEtf: h.type === "etf", gold: h.type === "etf" && /gold/i.test(h.name) })),
          ];
        }
        if (alive) setCands(out);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setCands([]);
        }
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, isFund, online]);

  async function link(c: Candidate) {
    let next: Instrument;
    if (c.type === "scheme") {
      const cls = classifyScheme(c.hit);
      next = {
        ...inst,
        kind: "mf",
        // Keep classification the user already set; fill in what's missing.
        assetClass: inst.kind === "mf" ? inst.assetClass : (cls.assetClass ?? inst.assetClass),
        taxClass: inst.kind === "mf" ? inst.taxClass : (cls.taxClass ?? inst.taxClass),
        segment: inst.segment ?? cls.segment,
        trackingIndex: inst.trackingIndex ?? cls.trackingIndex,
        details: { ...(inst.details.kind === "mf" ? inst.details : blankDetails("mf")), kind: "mf", amfiCode: c.hit.code, category: c.hit.category } as Instrument["details"],
      };
    } else if (c.gold) {
      next = { ...inst, kind: "gold", assetClass: "gold", taxClass: "listedOther", details: { kind: "gold", form: "etf", symbol: c.symbol, exchange: c.exchange } };
    } else {
      const k = c.isEtf ? "etf" : "stock";
      next = {
        ...inst,
        kind: k,
        sector: inst.sector ?? (k === "stock" ? c.sector : undefined),
        segment: inst.segment ?? (k === "stock" ? "direct" : "index"),
        details: { kind: k, exchange: c.exchange, symbol: c.symbol },
      };
    }
    await db.instruments.put(next);
    onLinked(c.type === "scheme" ? `AMFI ${c.hit.code}` : `${c.exchange}: ${c.symbol}`);
  }

  return (
    <li className={cx("rounded-2xl border p-3", linkedAs ? "border-accent/40 bg-accent-soft/30" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
          {inst.name}
          {currentId(inst) && !linkedAs && <span className="ml-2 text-xs font-normal text-warn">{currentId(inst)} returned no price</span>}
        </span>
        {avg !== null && <span className="text-xs text-muted num">avg cost {formatPrice(avg)}</span>}
        {linkedAs ? (
          <Badge tone="accent">✓ {linkedAs}</Badge>
        ) : (
          <Select value={kind} onChange={(e) => setKind(e.target.value as InstrumentKind)} className="w-auto py-1 text-xs" aria-label={`Type of ${inst.name}`}>
            {(["stock", "etf", "mf", "gold"] as InstrumentKind[]).map((k) => (
              <option key={k} value={k}>
                {k === "gold" ? "Gold ETF" : KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </div>
      {!linkedAs && (
        <>
          <Input className="mt-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder={isFund ? "Fund name or AMFI code" : "Company name or NSE symbol"} aria-label={`Search for ${inst.name}`} />
          <div className="mt-2 flex flex-col">
            {cands === null && <span className="px-2 py-1 text-xs text-faint">Searching…</span>}
            {error && <span className="px-2 py-1 text-xs text-warn">{error}</span>}
            {cands?.length === 0 && !error && (
              <span className="px-2 py-1 text-xs text-faint">{isFund && !online ? "Fund search needs the price proxy." : "No matches. Try a shorter name or the NSE symbol."}</span>
            )}
            {cands?.map((c) => (
              <button
                key={c.type === "scheme" ? c.hit.code : `${c.exchange}:${c.symbol}`}
                onClick={() => void link(c)}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-sunken"
              >
                <span className="min-w-0">
                  <span className="block [overflow-wrap:anywhere]">{c.type === "scheme" ? c.hit.name : c.name}</span>
                  <span className="block text-xs text-muted">
                    {c.type === "scheme" ? `AMFI ${c.hit.code} · NAV ${formatPrice(c.hit.nav)} on ${c.hit.date}` : `${c.exchange}: ${c.symbol}${c.sector ? ` · ${c.sector}` : ""}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-accent">Use</span>
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}
