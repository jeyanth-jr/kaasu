import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAdd } from "../App";
import { db } from "../db/db";
import { formatDate, monthKey, todayISO } from "../domain/dates";
import { parseLookThroughPaste, latestLookThrough } from "../domain/equity";
import { formatINR, formatPrice, formatQty } from "../domain/money";
import { PriceIndex } from "../domain/portfolio";
import { lotViews } from "../domain/tax";
import type { Instrument } from "../domain/types";
import { KIND_LABEL, isMarketKind } from "../domain/types";
import { setManualPrice } from "../prices/client";
import { Badge, Button, Callout, Card, Change, EmptyState, Field, Input, Money, PageHeader, PctChange, PriceStamp, Sheet, Stat, cx } from "../ui/components";
import { useData } from "../ui/data";
import { IconEdit, IconPlus } from "../ui/icons";
import { InstrumentForm, validateInstrument } from "../ui/InstrumentForm";
import { NumberInput } from "../ui/inputs";
import { TxnTable } from "./Transactions";

export function HoldingDetailPage() {
  const { id } = useParams();
  const { portfolio, txns, prices, settings, lookThrough, asOf, instrumentById } = useData();
  const { openAdd } = useAdd();
  const nav = useNavigate();
  const [editing, setEditing] = useState<Instrument | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [ltOpen, setLtOpen] = useState(false);
  const h = portfolio.holdings.find((x) => x.instrument.id === id);
  const inst = instrumentById.get(id ?? "");
  const myTxns = useMemo(() => txns.filter((t) => t.instrumentId === id), [txns, id]);
  const series = useMemo(() => new PriceIndex(prices).series(id ?? ""), [prices, id]);

  if (!inst || !h) {
    return (
      <EmptyState title="Holding not found" action={<Link to="/holdings"><Button>Back to holdings</Button></Link>}>
        It may have been deleted or archived.
      </EmptyState>
    );
  }

  const market = isMarketKind(inst.kind);
  const lots = h.book ? lotViews(inst.id, inst.taxClass, h.book.open, h.price?.price ?? null, asOf, settings.tax) : [];
  const d = inst.details;
  const plPct = h.invested > 0 ? (h.unrealized / h.invested) * 100 : null;
  const lt = latestLookThrough(lookThrough, inst.id);

  async function remove() {
    if (!inst) return;
    if (!confirm(`Delete ${inst.name} and its ${myTxns.length} transactions? This can't be undone (unless you restore a backup).`)) return;
    await db.transaction("rw", [db.instruments, db.txns, db.prices, db.lookThrough], async () => {
      const own = await db.txns.where("instrumentId").equals(inst.id).primaryKeys();
      for (const id of own) await db.txns.where("fundsTxnId").equals(id).delete();
      await db.txns.where("instrumentId").equals(inst.id).delete();
      await db.prices.where("instrumentId").equals(inst.id).delete();
      await db.lookThrough.where("instrumentId").equals(inst.id).delete();
      await db.instruments.delete(inst.id);
    });
    nav("/holdings");
  }

  return (
    <>
      <div className="mb-2 text-sm">
        <Link to="/holdings" className="text-muted hover:text-ink">← Holdings</Link>
      </div>
      <PageHeader
        title={inst.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{KIND_LABEL[inst.kind]}</Badge>
            {inst.sample && <Badge tone="warn">sample</Badge>}
            {h.closed && <Badge>closed</Badge>}
            {detailLine(inst)}
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => setEditing(inst)}>
              <IconEdit size={15} /> Edit
            </Button>
            <Button variant="primary" onClick={() => openAdd({ instrumentId: inst.id })}>
              <IconPlus size={15} /> Transaction
            </Button>
          </div>
        }
      />

      {h.warnings.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {h.warnings.map((w, i) => (
            <Callout key={i} tone="warn" title="Check your transactions">{w}</Callout>
          ))}
        </div>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Current value" value={<Money p={h.value} />} sub={valueNote(h.valueSource)} />
          <Stat label={h.closed ? "Realised P/L" : "Unrealised P/L"} value={<Change p={h.closed ? h.realized : h.unrealized} hideArrow />} sub={h.closed ? undefined : <PctChange pct={plPct} />} />
          <Stat label="Invested" value={<Money p={h.invested} />} sub={market && h.qty > 0 ? `avg ${formatPrice(h.invested / 100 / h.qty)} · ${formatQty(h.qty)} units` : undefined} />
          <Stat label="XIRR" value={<PctChange pct={h.xirr === null ? null : h.xirr * 100} />} sub={h.income > 0 ? <>incl. <Money p={h.income} /> income</> : h.realized !== 0 && !h.closed ? <>realised <Change p={h.realized} hideArrow /></> : undefined} />
        </div>
        {h.prematureValue !== null && (
          <p className="mt-4 text-xs text-muted">
            Breaking it today returns about <Money p={h.prematureValue} /> after the {d.kind === "rd" || d.kind === "fd" ? d.penaltyPct : 0}% penalty
            {h.maturity && <> · matures {formatDate(h.maturity)}</>}.
          </p>
        )}
        {h.tdsPaid > 0 && <p className="mt-2 text-xs text-muted">TDS deducted so far: <Money p={h.tdsPaid} /> (claim it in your return).</p>}
      </Card>

      {market && (
        <Card
          title="Price"
          className="mb-4"
          action={
            <Button size="sm" onClick={() => setPriceOpen(true)}>
              Set price
            </Button>
          }
        >
          <PriceStamp point={h.price} ageDays={h.priceAgeDays} className="text-sm" />
          {series.length > 2 && (
            <div className="money mt-3 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.map((p) => ({ date: p.date, price: p.price }))} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
                    labelFormatter={(x) => formatDate(String(x))}
                    formatter={(v) => [formatPrice(Number(v)), "Price"]}
                  />
                  <Line type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}

      {lots.length > 0 && (
        <Card title="Open lots (FIFO)" className="mb-4" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Bought</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Gain</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Term</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.lot.id} className="border-t border-line">
                    <td className="px-4 py-2 num sm:px-5">
                      {formatDate(l.lot.date)}
                      <div className="text-xs text-faint">{l.holdingDays} days</div>
                    </td>
                    <td className="px-3 py-2 text-right num">{formatQty(l.lot.qty)}</td>
                    <td className="px-3 py-2 text-right">
                      <Money p={l.lot.cost} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Change p={l.gain} hideArrow />
                    </td>
                    <td className="px-4 py-2 sm:px-5">
                      {l.longTermFrom === null ? (
                        <Badge>slab</Badge>
                      ) : l.term === "long" ? (
                        <Badge tone="accent">Long-term</Badge>
                      ) : (
                        <span className="text-xs text-muted">
                          <Badge>Short</Badge> LT from {formatDate(l.longTermFrom)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inst.assetClass === "equity" && inst.kind !== "stock" && (
        <Card
          title="Fund look-through"
          className="mb-4"
          action={
            <Button size="sm" onClick={() => setLtOpen(true)}>
              {lt ? "Update" : "Paste holdings"}
            </Button>
          }
        >
          {lt ? (
            <>
              <p className="mb-2 text-xs text-muted">
                {lt.holdings.length} holdings · {lt.holdings.reduce((s, x) => s + x.weightPct, 0).toFixed(1)}% of the fund · as of {lt.month}
              </p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {lt.holdings.slice(0, 10).map((x) => (
                  <li key={x.name} className="flex justify-between gap-2">
                    <span className="truncate">{x.name}</span>
                    <span className="num text-muted">{x.weightPct}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Paste the fund's top holdings from its monthly factsheet to include them in stock and sector concentration checks.</p>
          )}
        </Card>
      )}

      <Card title={`Transactions (${myTxns.length})`} pad={false} className="mb-4">
        <TxnTable txns={myTxns} hideInstrument />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void db.instruments.update(inst.id, { archived: !inst.archived })}>{inst.archived ? "Unarchive" : "Archive (hide)"}</Button>
        <Button variant="danger" onClick={remove}>
          Delete holding
        </Button>
      </div>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${inst.name}`}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              if (!editing) return;
              const e = validateInstrument(editing);
              if (e) return alert(e);
              await db.instruments.put(editing);
              setEditing(null);
            }}
          >
            Save
          </Button>
        }
      >
        {editing && <InstrumentForm value={editing} onChange={setEditing} />}
      </Sheet>

      {priceOpen && <PriceSheet open onClose={() => setPriceOpen(false)} instrument={inst} current={h.price?.price ?? null} />}
      {ltOpen && <LookThroughSheet open onClose={() => setLtOpen(false)} instrument={inst} existing={lt?.holdings.map((x) => `${x.name}\t${x.sector ?? ""}\t${x.weightPct}`).join("\n") ?? ""} />}
    </>
  );
}

function valueNote(src: string): string | undefined {
  return {
    price: undefined,
    lastTrade: "at last trade price",
    cost: "at cost (no price)",
    accrual: "accrued, estimated",
    balance: undefined,
    paid: "amount paid so far",
  }[src];
}

function detailLine(i: Instrument): React.ReactNode {
  const d = i.details;
  switch (d.kind) {
    case "stock":
    case "etf":
      return <span className="text-muted">{d.exchange}: {d.symbol}{i.sector ? ` · ${i.sector}` : ""}</span>;
    case "mf":
      return <span className="text-muted">AMFI {d.amfiCode || "—"}{d.sip ? ` · SIP ${formatINR(d.sip.amount)} on day ${d.sip.day}` : ""}</span>;
    case "rd":
      return <span className="text-muted">{d.bank} · {formatINR(d.monthlyAmount)}/mo · {d.ratePct}% · {d.tenureMonths} months</span>;
    case "fd":
      return <span className="text-muted">{d.bank} · {d.ratePct}% · matures {formatDate(d.maturity)}{d.sweepIn ? " · sweep-in" : ""}</span>;
    case "bond":
      return <span className="text-muted">{d.issuer} · {d.couponPct}% {d.payout} · {d.rating ?? "unrated"} · matures {formatDate(d.maturity)}</span>;
    case "gold":
      return <span className="text-muted">{d.form === "etf" ? `ETF ${d.symbol ?? ""}` : `Physical${d.purity ? ` · ${d.purity}` : ""}`}</span>;
    case "cash":
      return <span className="text-muted">{d.bank} · {d.account}</span>;
    case "commitment":
      return <span className="text-muted">For {d.beneficiary} · {formatINR(d.monthlyAmount)}/mo</span>;
  }
}

function PriceSheet({ open, onClose, instrument, current }: { open: boolean; onClose: () => void; instrument: Instrument; current: number | null }) {
  const [price, setPrice] = useState<number | null>(current);
  const [date, setDate] = useState(todayISO());
  const unit = instrument.details.kind === "gold" && instrument.details.form === "physical" ? "per gram" : "per unit";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Set price manually"
      footer={
        <Button
          variant="primary"
          disabled={!price || price <= 0}
          onClick={async () => {
            if (!price) return;
            await setManualPrice(instrument.id, date, price);
            onClose();
          }}
        >
          Save price
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Price ${unit}`}>{(id) => <NumberInput id={id} value={price} onChange={setPrice} />}</Field>
        <Field label="As of">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-xs text-muted">Manual prices are stored with this date and shown with a "Manual" label so you always know how fresh they are.</p>
    </Sheet>
  );
}

function LookThroughSheet({ open, onClose, instrument, existing }: { open: boolean; onClose: () => void; instrument: Instrument; existing: string }) {
  const [text, setText] = useState(existing);
  const [month, setMonth] = useState(monthKey(todayISO()));
  const parsed = parseLookThroughPaste(text);
  const total = parsed.holdings.reduce((s, x) => s + x.weightPct, 0);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title={`Look-through · ${instrument.name}`}
      footer={
        <Button
          variant="primary"
          disabled={parsed.holdings.length === 0 || total > 100.5}
          onClick={async () => {
            await db.lookThrough.put({ instrumentId: instrument.id, month, holdings: parsed.holdings });
            onClose();
          }}
        >
          Save {parsed.holdings.length} holdings
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Factsheet month">{(id) => <Input id={id} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
        <Field label="Holdings" hint="One per line: name, sector (optional), weight %. Tabs, commas or 2+ spaces separate columns. Copying a table from a factsheet usually works.">
          {(id) => (
            <textarea
              id={id}
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"HDFC Bank\tFinancials\t9.8\nICICI Bank\tFinancials\t7.1"}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs"
            />
          )}
        </Field>
        <p className={cx("text-xs", total > 100.5 ? "text-loss" : "text-muted")}>
          Parsed {parsed.holdings.length} rows totalling {total.toFixed(2)}%{parsed.skipped.length ? ` · skipped ${parsed.skipped.length} line(s) without a weight` : ""}
        </p>
      </div>
    </Sheet>
  );
}
