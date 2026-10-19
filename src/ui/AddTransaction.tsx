import { useEffect, useMemo, useState } from "react";
import { deleteTxnCascade, fundingAccountOf, syncFunding } from "../db/accounts";
import { db, newId, nowISO, saveSettings } from "../db/db";
import { activeAccounts, fundingDirection } from "../domain/accounts";
import { searchKnownSymbols, type KnownSymbol } from "../data/symbols";
import { addMonths, isValidISO, todayISO, withDay } from "../domain/dates";
import { matchFifo, openQty } from "../domain/lots";
import { formatINR, formatQty, roundQty } from "../domain/money";
import type { EquitySegment, Instrument, InstrumentKind, Transaction, TxnType } from "../domain/types";
import { KIND_LABEL, isMarketKind } from "../domain/types";
import { proxyOnline, searchSchemes, searchSymbols, type SchemeHit, type SymbolHit } from "../prices/client";
import { Badge, Button, Callout, Field, Input, Select, Sheet, Toggle, cx } from "./components";
import { useData } from "./data";
import { IconSearch } from "./icons";
import { InstrumentForm, blankInstrument, validateInstrument } from "./InstrumentForm";
import { MoneyInput, NumberInput } from "./inputs";

type Step = "pick" | "instrument" | "txn";

const TYPE_LABEL: Record<TxnType, string> = {
  buy: "Buy",
  sell: "Sell",
  sip: "SIP instalment",
  bonus: "Bonus units",
  split: "Split",
  deposit: "Deposit",
  rd_instalment: "RD instalment",
  withdrawal: "Withdrawal",
  interest: "Interest",
  coupon: "Coupon",
  dividend: "Dividend",
  redemption: "Redemption (by issuer)",
  maturity: "Maturity proceeds",
  fee: "Fee / charge",
  commitment_payment: "Payment",
  balance_adjust: "Balance correction",
};

export function typesFor(kind: InstrumentKind): TxnType[] {
  switch (kind) {
    case "stock":
    case "etf":
      return ["buy", "sell", "dividend", "bonus", "split", "fee"];
    case "mf":
      return ["sip", "buy", "sell", "dividend"];
    case "gold":
      return ["buy", "sell"];
    case "bond":
      return ["buy", "sell", "coupon", "redemption"];
    case "rd":
      return ["rd_instalment", "interest", "maturity", "withdrawal"];
    case "fd":
      return ["deposit", "interest", "maturity", "withdrawal"];
    case "cash":
      return ["deposit", "withdrawal", "interest", "balance_adjust", "fee"];
    case "commitment":
      return ["commitment_payment"];
  }
}

const QTY_TYPES: TxnType[] = ["buy", "sell", "sip", "redemption", "bonus", "split"];
const PRICED_TYPES: TxnType[] = ["buy", "sell", "sip", "redemption"];

interface TxnDraft {
  type: TxnType;
  date: string;
  qty: number | null;
  price: number | null;
  amount: number | null; // paise
  amountTouched: boolean;
  charges: number | null;
  tds: number | null;
  notes: string;
  backfill: boolean;
  /** Bank account the money came from or went to ("" = not tracked). */
  fundingId: string;
}

function defaultDraft(inst: Instrument | null, existing?: Transaction): TxnDraft {
  if (existing) {
    return {
      type: existing.type,
      date: existing.date,
      qty: existing.qty ?? null,
      price: existing.price ?? null,
      amount: existing.amount,
      amountTouched: true,
      charges: existing.charges ?? null,
      tds: existing.tds ?? null,
      notes: existing.notes ?? "",
      backfill: false,
      fundingId: "",
    };
  }
  const kind = inst?.kind ?? "stock";
  const d = inst?.details;
  let date = todayISO();
  let amount: number | null = null;
  if (d?.kind === "fd" && !inst?.id) date = d.start;
  if (d?.kind === "rd") amount = d.monthlyAmount;
  if (d?.kind === "commitment") amount = d.monthlyAmount;
  if (d?.kind === "mf" && d.sip) amount = d.sip.amount;
  return {
    type: d?.kind === "mf" && d.sip ? "sip" : typesFor(kind)[0]!,
    date,
    qty: null,
    price: null,
    amount,
    amountTouched: amount !== null,
    charges: null,
    tds: null,
    notes: "",
    backfill: !inst?.id && (d?.kind === "rd" || d?.kind === "commitment"),
    fundingId: "",
  };
}

/** Guess classification from an AMFI category string and scheme name. */
export function classifyScheme(hit: { name: string; category?: string }): Partial<Instrument> {
  const c = `${hit.category ?? ""} ${hit.name}`.toLowerCase();
  const debt = /debt|liquid|money market|gilt|overnight|ultra short|low duration|short duration|medium duration|corporate bond|banking and psu|credit risk|floater|dynamic bond|long duration/.test(c);
  if (/gold/.test(c) && !/equity/.test(hit.category?.toLowerCase() ?? "")) return { assetClass: "gold", taxClass: "listedOther", emergencyLayer: "none" };
  if (debt) return { assetClass: "debt", taxClass: "slab", emergencyLayer: /liquid|overnight|money market/.test(c) ? "instant" : "second", segment: undefined };
  if (/hybrid|arbitrage|balanced|asset allocation|fund of funds|fof/.test(c) && !/equity savings/.test(c)) {
    if (/arbitrage/.test(c)) return { assetClass: "debt", taxClass: "equity", emergencyLayer: "second" };
    if (/overseas|international|nasdaq|us /.test(c)) return { assetClass: "equity", taxClass: "listedOther", segment: "international" };
  }
  let segment: EquitySegment = "other";
  let trackingIndex: string | undefined;
  if (/index|etf/.test(c)) {
    segment = "index";
    const m = /(nifty\s*(next\s*50|50|100|midcap\s*150|smallcap\s*250|500|bank)|sensex|nasdaq\s*100)/i.exec(hit.name);
    if (m) trackingIndex = m[1]!.toUpperCase().replace(/\s+/g, " ");
  } else if (/large\s*&\s*mid|large and mid/.test(c)) segment = "multi";
  else if (/large cap/.test(c)) segment = "large";
  else if (/mid cap/.test(c)) segment = "mid";
  else if (/small cap/.test(c)) segment = "small";
  else if (/flexi/.test(c)) segment = "flexi";
  else if (/multi cap/.test(c)) segment = "multi";
  else if (/elss|tax saver/.test(c)) segment = "elss";
  else if (/sectoral|thematic/.test(c)) segment = "sectoral";
  return { assetClass: "equity", taxClass: "equity", segment, trackingIndex };
}

export function AddTransactionSheet({ open, instrumentId, txnId, onClose }: { open: boolean; instrumentId?: string; txnId?: string; onClose: () => void }) {
  const { instruments, instrumentById, txns, settings } = useData();
  const [step, setStep] = useState<Step>("pick");
  const [inst, setInst] = useState<Instrument | null>(null);
  const [draft, setDraft] = useState<TxnDraft>(defaultDraft(null));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = txnId ? txns.find((t) => t.id === txnId) : undefined;

  useEffect(() => {
    if (!open) return;
    setQ("");
    setError(null);
    const existing = editing ? instrumentById.get(editing.instrumentId) : instrumentId ? instrumentById.get(instrumentId) : undefined;
    if (existing) {
      setInst(existing);
      const mirror = fundingAccountOf(editing?.id, txns);
      const accounts = activeAccounts(instruments);
      const last = accounts.some((a) => a.id === settings.lastAccountId) ? settings.lastAccountId! : "";
      setDraft({ ...defaultDraft(existing, editing), fundingId: editing ? (mirror?.instrumentId ?? "") : existing.kind === "cash" ? "" : last });
      setStep("txn");
    } else {
      setInst(null);
      setStep("pick");
    }
  }, [open, instrumentId, txnId]);

  const choose = (i: Instrument) => {
    setInst(i);
    const last = activeAccounts(instruments).some((a) => a.id === settings.lastAccountId) ? settings.lastAccountId! : "";
    setDraft({ ...defaultDraft(i), fundingId: i.kind === "cash" ? "" : last });
    setStep(i.id ? "txn" : "instrument");
  };

  const heldQty = useMemo(() => {
    if (!inst?.id || !isMarketKind(inst.kind)) return null;
    return openQty(matchFifo(txns.filter((t) => t.instrumentId === inst.id && t.id !== txnId)));
  }, [inst, txns, txnId]);

  async function save() {
    if (!inst) return;
    const err = validateTxn(inst, draft, heldQty);
    if (err) return setError(err);
    setSaving(true);
    try {
      const created = nowISO();
      let instrument = inst;
      if (!inst.id) {
        instrument = { ...inst, id: newId("i_"), createdAt: created, name: inst.name.trim() };
        await db.instruments.add(instrument);
      }
      const rows: Transaction[] = [];
      const base = {
        instrumentId: instrument.id,
        type: draft.type,
        qty: QTY_TYPES.includes(draft.type) ? roundQty(draft.qty ?? 0) : undefined,
        price: PRICED_TYPES.includes(draft.type) ? draft.price ?? undefined : undefined,
        amount: draft.type === "bonus" || draft.type === "split" ? 0 : (draft.amount ?? 0),
        charges: draft.charges ?? undefined,
        tds: draft.tds ?? undefined,
        notes: draft.notes.trim() || undefined,
        source: "manual" as const,
      };
      const d = instrument.details;
      if (draft.backfill && (d.kind === "rd" || d.kind === "commitment")) {
        const day = d.kind === "rd" ? Number(d.start.slice(8, 10)) : d.day;
        const stop = d.kind === "rd" ? addMonths(d.start, d.tenureMonths) : d.end ?? "9999-12-31";
        for (let m = 0; m < 600; m++) {
          const date = withDay(addMonths(d.start, m), day);
          if (date > todayISO() || date >= stop) break;
          if (date < d.start) continue;
          rows.push({ ...base, id: newId("t_"), date, createdAt: created });
        }
      } else {
        rows.push({ ...base, id: editing?.id ?? newId("t_"), date: draft.date, createdAt: editing?.createdAt ?? created, source: editing?.source === "csv" ? "csv" : "manual", importBatchId: editing?.importBatchId });
      }
      await db.txns.bulkPut(rows);
      const funding = instrument.kind === "cash" ? undefined : draft.fundingId || undefined;
      for (const r of rows) await syncFunding(r, funding);
      if (funding) await saveSettings({ lastAccountId: funding });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm("Delete this transaction?")) return;
    await deleteTxnCascade(editing.id);
    onClose();
  }

  const title = editing ? "Edit transaction" : step === "pick" ? "Add transaction" : step === "instrument" ? `New ${KIND_LABEL[inst!.kind].toLowerCase()}` : inst?.name || "Add transaction";

  const footer =
    step === "instrument" ? (
      <>
        <Button variant="ghost" onClick={() => setStep("pick")}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            const e = validateInstrument(inst!);
            if (e) return setError(e);
            setError(null);
            setDraft(defaultDraft(inst));
            setStep("txn");
          }}
        >
          Next
        </Button>
      </>
    ) : step === "txn" ? (
      <>
        {editing && (
          <Button variant="danger" className="mr-auto" onClick={remove}>
            Delete
          </Button>
        )}
        {!editing && !instrumentId && (
          <Button variant="ghost" onClick={() => setStep(inst?.id ? "pick" : "instrument")}>
            Back
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Save"}
        </Button>
      </>
    ) : undefined;

  return (
    <Sheet open={open} onClose={onClose} title={title} footer={footer}>
      {error && (
        <div className="mb-3">
          <Callout tone="warn">{error}</Callout>
        </div>
      )}
      {step === "pick" && <Picker q={q} setQ={setQ} instruments={instruments} onPick={choose} />}
      {step === "instrument" && inst && <InstrumentForm value={inst} onChange={setInst} />}
      {step === "txn" && inst && <TxnForm inst={inst} draft={draft} setDraft={setDraft} heldQty={heldQty} isNew={!inst.id} />}
    </Sheet>
  );
}

function validateTxn(inst: Instrument, d: TxnDraft, held: number | null): string | null {
  if (!isValidISO(d.date) && !d.backfill) return "Pick a valid date.";
  if (d.date > todayISO() && !d.backfill) return "That date is in the future. Planned items belong in the monthly plan.";
  if (QTY_TYPES.includes(d.type) && !(d.qty && d.qty > 0)) return d.type === "split" ? "Enter the split ratio (new shares per old share, e.g. 5 for a 1:5 split)." : "Enter a quantity.";
  if (PRICED_TYPES.includes(d.type) && !(d.amount && d.amount > 0)) return "Enter a price or amount.";
  if (!QTY_TYPES.includes(d.type) && d.type !== "balance_adjust" && !(d.amount && d.amount > 0)) return "Enter an amount.";
  if (d.type === "balance_adjust" && !d.amount) return "Enter the correction amount (negative to reduce).";
  if ((d.type === "sell" || d.type === "redemption") && held !== null && (d.qty ?? 0) > held + 1e-6) return `You only hold ${formatQty(held)} units on record.`;
  if (inst.kind === "stock" && d.qty && !Number.isInteger(d.qty) && d.type !== "split") return "Shares are whole numbers.";
  return null;
}

// ---------------------------------------------------------------------------

function Picker({ q, setQ, instruments, onPick }: { q: string; setQ: (s: string) => void; instruments: Instrument[]; onPick: (i: Instrument) => void }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [schemes, setSchemes] = useState<SchemeHit[]>([]);
  const [symbols, setSymbols] = useState<SymbolHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void proxyOnline().then(setOnline);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!online || term.length < 3) {
      setSchemes([]);
      setSymbols([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const [a, b] = await Promise.allSettled([searchSchemes(term), searchSymbols(term)]);
      if (!alive) return;
      setSchemes(a.status === "fulfilled" ? a.value.slice(0, 8) : []);
      setSymbols(b.status === "fulfilled" ? b.value.slice(0, 6) : []);
      setLoading(false);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, online]);

  const term = q.trim().toLowerCase();
  const mine = instruments
    .filter((i) => !i.archived)
    .filter((i) => !term || i.name.toLowerCase().includes(term) || symbolText(i).toLowerCase().includes(term))
    .slice(0, term ? 8 : 6);
  const known = searchKnownSymbols(q).filter((k) => !instruments.some((i) => symbolText(i) === k.symbol));
  const liveSymbols = symbols.filter((s) => !known.some((k) => k.symbol === s.symbol) && !instruments.some((i) => symbolText(i) === s.symbol));

  const fromKnown = (k: KnownSymbol | SymbolHit) => {
    const isGold = "gold" in k ? !!k.gold : /gold/i.test(k.name) && k.type === "etf";
    const kind: InstrumentKind = isGold ? "gold" : k.type;
    const base = blankInstrument(kind, k.name);
    const exchange = "exchange" in k ? k.exchange : "NSE";
    if (kind === "gold") return onPick({ ...base, details: { kind: "gold", form: "etf", symbol: k.symbol, exchange } });
    const tracking = "trackingIndex" in k ? k.trackingIndex : undefined;
    onPick({
      ...base,
      sector: kind === "stock" ? k.sector : undefined,
      segment: kind === "stock" ? "direct" : "index",
      trackingIndex: tracking,
      details: { kind, exchange, symbol: k.symbol } as Instrument["details"],
    });
  };

  const fromScheme = (s: SchemeHit) => {
    const base = blankInstrument("mf", s.name);
    onPick({ ...base, ...classifyScheme(s), details: { kind: "mf", amfiCode: s.code, category: s.category } });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <IconSearch size={17} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <Input autoFocus placeholder="Search holdings, NSE symbols or fund names…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      {online === false && <p className="text-xs text-faint">Price proxy offline — fund-name search is unavailable, but you can type a symbol or create anything manually.</p>}

      {mine.length > 0 && (
        <Group title={term ? "In your portfolio" : "Recent"}>
          {mine.map((i) => (
            <Row key={i.id} onClick={() => onPick(i)} title={i.name} meta={<Badge>{KIND_LABEL[i.kind]}</Badge>} sub={symbolText(i) || undefined} />
          ))}
        </Group>
      )}

      {(known.length > 0 || liveSymbols.length > 0) && (
        <Group title="Stocks & ETFs">
          {known.map((k) => (
            <Row key={k.symbol} onClick={() => fromKnown(k)} title={k.name} sub={`NSE: ${k.symbol} · ${k.sector}`} meta={<Badge tone="accent">New</Badge>} />
          ))}
          {liveSymbols.map((k) => (
            <Row key={`${k.exchange}${k.symbol}`} onClick={() => fromKnown(k)} title={k.name} sub={`${k.exchange}: ${k.symbol}${k.sector ? ` · ${k.sector}` : ""}`} meta={<Badge tone="accent">New</Badge>} />
          ))}
        </Group>
      )}

      {(schemes.length > 0 || (loading && term.length >= 3)) && (
        <Group title="Mutual funds (AMFI)">
          {loading && schemes.length === 0 && <p className="px-3 py-2 text-xs text-faint">Searching…</p>}
          {schemes.map((s) => (
            <Row key={s.code} onClick={() => fromScheme(s)} title={s.name} sub={`Code ${s.code}${s.category ? ` · ${s.category}` : ""}`} meta={<Badge tone="accent">New</Badge>} />
          ))}
        </Group>
      )}

      <Group title="Create manually">
        <div className="grid grid-cols-2 gap-2 p-1 sm:grid-cols-3">
          {(["stock", "etf", "mf", "fd", "rd", "bond", "gold", "cash", "commitment"] as InstrumentKind[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                const looksLikeSymbol = /^[A-Za-z&-]{2,15}$/.test(q.trim());
                const base = blankInstrument(k, q.trim() && !looksLikeSymbol ? q.trim() : "");
                if ((k === "stock" || k === "etf") && looksLikeSymbol) {
                  base.name = q.trim().toUpperCase();
                  base.details = { kind: k, exchange: "NSE", symbol: q.trim().toUpperCase() };
                }
                onPick(base);
              }}
              className="rounded-xl border border-line px-3 py-2.5 text-left text-sm hover:border-accent hover:bg-accent-soft/40"
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Group>
    </div>
  );
}

function symbolText(i: Instrument): string {
  const d = i.details;
  if (d.kind === "stock" || d.kind === "etf") return d.symbol;
  if (d.kind === "gold") return d.symbol ?? "";
  if (d.kind === "mf") return d.amfiCode;
  return "";
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ title, sub, meta, onClick }: { title: string; sub?: string; meta?: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-sunken">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      {meta}
    </button>
  );
}

// ---------------------------------------------------------------------------

function TxnForm({ inst, draft, setDraft, heldQty, isNew }: { inst: Instrument; draft: TxnDraft; setDraft: (d: TxnDraft) => void; heldQty: number | null; isNew: boolean }) {
  const set = (patch: Partial<TxnDraft>) => {
    const next = { ...draft, ...patch };
    // Keep amount = qty × price until the user edits amount directly.
    if (!next.amountTouched && PRICED_TYPES.includes(next.type) && next.qty && next.price) next.amount = Math.round(next.qty * next.price * 100);
    setDraft(next);
  };
  const { instruments } = useData();
  const accounts = activeAccounts(instruments);
  const types = typesFor(inst.kind);
  const qtyLabel = inst.kind === "gold" && inst.details.kind === "gold" && inst.details.form === "physical" ? "Grams" : inst.kind === "mf" ? "Units" : inst.kind === "bond" ? "Units (bonds)" : "Quantity";
  const showQty = QTY_TYPES.includes(draft.type);
  const showPrice = PRICED_TYPES.includes(draft.type);
  const showAmount = draft.type !== "bonus" && draft.type !== "split";
  const d = inst.details;
  const canBackfill = isNew && (d.kind === "rd" || d.kind === "commitment") && d.start < todayISO();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {isNew && (
        <div className="sm:col-span-2">
          <Callout tone="accent" title={`Creating ${inst.name || "new instrument"}`}>
            Add its first transaction below. You can edit the details later from Holdings.
          </Callout>
        </div>
      )}
      <Field label="Type">
        {(id) => (
          <Select id={id} value={draft.type} onChange={(e) => set({ type: e.target.value as TxnType, amountTouched: false })}>
            {types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {!(canBackfill && draft.backfill) && (
        <Field label="Date">{(id) => <Input id={id} type="date" value={draft.date} max={todayISO()} onChange={(e) => set({ date: e.target.value })} />}</Field>
      )}
      {canBackfill && (
        <div className="sm:col-span-2 rounded-xl border border-line px-3">
          <Toggle
            checked={draft.backfill}
            onChange={(v) => set({ backfill: v })}
            label="Add every past instalment since the start date"
            hint={`Creates one ${formatINR(draft.amount ?? 0)} entry per month up to today`}
          />
        </div>
      )}
      {showQty && (
        <Field
          label={draft.type === "split" ? "Ratio (new per old)" : draft.type === "bonus" ? "Bonus units received" : qtyLabel}
          hint={heldQty !== null && (draft.type === "sell" || draft.type === "redemption") ? `You hold ${formatQty(heldQty)}` : draft.type === "split" ? "1:5 split → 5; 2:1 consolidation → 0.5" : undefined}
        >
          {(id) => <NumberInput id={id} value={draft.qty} onChange={(n) => set({ qty: n })} />}
        </Field>
      )}
      {showPrice && (
        <Field label={inst.kind === "mf" ? "NAV" : inst.kind === "gold" && d.kind === "gold" && d.form === "physical" ? "Price per gram" : "Price per unit"}>
          {(id) => <NumberInput id={id} value={draft.price} onChange={(n) => set({ price: n })} />}
        </Field>
      )}
      {showAmount && (
        <Field
          label={draft.type === "balance_adjust" ? "Correction (− to reduce)" : showPrice ? "Amount" : "Amount"}
          hint={showPrice ? (draft.amountTouched ? "Edited — price follows amount ÷ quantity" : "Quantity × price") : undefined}
        >
          {(id) => (
            <MoneyInput
              id={id}
              value={draft.amount}
              allowNegative={draft.type === "balance_adjust"}
              onChange={(p) => {
                const next: Partial<TxnDraft> = { amount: p, amountTouched: true };
                if (showPrice && p && draft.qty) next.price = Math.round((p / 100 / draft.qty) * 10000) / 10000;
                setDraft({ ...draft, ...next });
              }}
            />
          )}
        </Field>
      )}
      {(showPrice || draft.type === "fee") && draft.type !== "fee" && (
        <Field label="Charges" hint="Brokerage, STT, stamp duty, GST">
          {(id) => <MoneyInput id={id} value={draft.charges} onChange={(p) => set({ charges: p })} />}
        </Field>
      )}
      {(draft.type === "interest" || draft.type === "coupon" || draft.type === "dividend" || draft.type === "maturity") && (
        <Field label="TDS deducted" hint="Amount above is before TDS">
          {(id) => <MoneyInput id={id} value={draft.tds} onChange={(p) => set({ tds: p })} />}
        </Field>
      )}
      {accounts.length > 0 && inst.kind !== "cash" && fundingDirection(draft.type) && (
        <Field label={fundingDirection(draft.type) === "out" ? "Paid from" : "Credited to"} hint={draft.fundingId ? "That account's balance is updated" : "Pick the bank account to keep its balance right"} className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={draft.fundingId} onChange={(e) => set({ fundingId: e.target.value })}>
              <option value="">Not tracked</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="Note" className="sm:col-span-2">
        {(id) => <Input id={id} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />}
      </Field>
      {showPrice && draft.amount && draft.qty ? (
        <p className={cx("text-xs text-muted sm:col-span-2 num")}>
          {formatQty(draft.qty)} × {draft.price ? `₹${draft.price}` : "—"} = {formatINR(draft.amount, { decimals: 2 })}
          {draft.charges ? ` + ${formatINR(draft.charges, { decimals: 2 })} charges` : ""}
        </p>
      ) : null}
    </div>
  );
}
