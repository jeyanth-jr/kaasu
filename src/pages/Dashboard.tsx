import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAdd } from "../App";
import { clearSampleData, loadSampleData } from "../db/sample";
import { daysBetween, formatDate, formatMonth, monthKey } from "../domain/dates";
import { formatCompact, formatINR, formatPct } from "../domain/money";
import { netWorthSeries } from "../domain/portfolio";
import { Badge, Button, Callout, Card, Change, EmptyState, Meter, Money, PageHeader, PctChange, Stat, Tabs, cx } from "../ui/components";
import { useData } from "../ui/data";
import { CLASS_COLOR, CLASS_LABEL, useAllocation, useEmergency, useEquity, useUpcoming } from "../ui/derived";
import { IconAlert, IconChevron } from "../ui/icons";

export function DashboardPage() {
  const data = useData();
  const { portfolio: pf, settings, instruments, ready } = data;
  const { openAdd } = useAdd();
  const [busy, setBusy] = useState(false);
  const hasSample = instruments.some((i) => i.sample);

  if (!ready) return <div className="py-20 text-center text-muted">Opening your ledger…</div>;

  if (instruments.length === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-6">
        <PageHeader title="Welcome to Kaasu" sub="A private, local-first tracker for everything you own." />
        <EmptyState
          title="Your ledger is empty"
          action={
            <>
              <Button variant="primary" onClick={() => openAdd()}>
                Add your first transaction
              </Button>
              <Link to="/settings#import">
                <Button>Import a CSV</Button>
              </Link>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await loadSampleData();
                  setBusy(false);
                }}
              >
                {busy ? "Loading…" : "Load sample data"}
              </Button>
            </>
          }
        >
          Every buy, SIP, RD instalment and interest payout is a dated transaction. Holdings, average cost, P/L, XIRR and tax lots are worked out from them.
          <br />
          <span className="mt-2 block text-xs text-faint">Sample data is fictional, clearly marked, and can be cleared in one click. Nothing leaves this device.</span>
        </EmptyState>
      </div>
    );
  }

  const gainPct = pf.invested > 0 ? (pf.unrealized / pf.invested) * 100 : null;
  const dayPct = pf.dayChangeBase > 0 ? (pf.dayChange / pf.dayChangeBase) * 100 : null;

  return (
    <div className="flex flex-col gap-4">
      {hasSample && (
        <Callout
          tone="warn"
          icon={<Badge tone="warn">SAMPLE</Badge>}
          title="You're looking at sample data"
        >
          <span>All holdings marked sample are fictional. </span>
          <button
            className="font-medium text-ink underline underline-offset-2"
            onClick={async () => {
              if (confirm("Remove all sample holdings and transactions? Your own entries stay.")) await clearSampleData();
            }}
          >
            Clear sample data
          </button>
        </Callout>
      )}

      {/* Hero */}
      <section className="rounded-3xl border border-line bg-surface p-5 sm:p-7">
        <div className="text-sm text-muted">Net worth · {formatDate(data.asOf)}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="display money num text-4xl font-medium sm:text-5xl">{formatINR(pf.netWorth)}</span>
          <span className="text-base text-muted money num">{formatCompact(pf.netWorth)}</span>
        </div>
        {!settings.includeCommitments && pf.commitmentsPaid > 0 && (
          <div className="mt-1 text-xs text-faint">
            Excludes <Money p={pf.commitmentsPaid} /> paid into commitments outside the portfolio
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Invested (cost)" value={<Money p={pf.invested} />} />
          <Stat label="Unrealised gain" value={<Change p={pf.unrealized} hideArrow />} sub={<PctChange pct={gainPct} />} />
          <Stat
            label="Today"
            value={pf.dayChangeBase > 0 ? <Change p={pf.dayChange} hideArrow /> : <span className="text-faint">—</span>}
            sub={pf.dayChangeBase > 0 ? <PctChange pct={dayPct} /> : "needs two price dates"}
          />
          <Stat label="XIRR" value={<PctChange pct={pf.xirr === null ? null : pf.xirr * 100} />} sub="excl. cash & commitments" />
        </div>
      </section>

      <NetWorthChart />

      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationCard />
        <EmergencyCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingCard />
        <AlertsCard />
      </div>
    </div>
  );
}

function NetWorthChart() {
  const { instruments, txns, prices, settings, asOf } = useData();
  const [range, setRange] = useState<"1y" | "3y" | "all">("all");
  const series = useMemo(() => netWorthSeries({ instruments, txns, prices, settings, asOf }), [instruments, txns, prices, settings, asOf]);
  const cut = range === "all" ? series : series.slice(-(range === "1y" ? 13 : 37));
  const estimated = cut.some((p) => p.estimated);
  if (series.length < 2) return null;
  const rows = cut.map((p) => ({ ...p, nw: p.netWorth / 100, inv: p.invested / 100 }));
  return (
    <Card
      title="Net worth over time"
      action={<Tabs value={range} onChange={setRange} options={[{ value: "1y", label: "1Y" }, { value: "3y", label: "3Y" }, { value: "all", label: "All" }]} />}
    >
      <div className="money h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatMonth(monthKey(d)).replace(" 20", " ’")} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tickFormatter={(v: number) => formatCompact(v * 100)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: "var(--muted)" }}
              labelFormatter={(d) => formatDate(String(d))}
              formatter={(v, name) => [formatINR(Math.round(Number(v) * 100)), name === "nw" ? "Net worth" : "Invested"]}
            />
            <Area type="monotone" dataKey="nw" stroke="var(--accent)" strokeWidth={2} fill="url(#nwFill)" />
            <Line type="monotone" dataKey="inv" stroke="var(--faint)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-accent" /> Net worth
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed border-faint" /> Invested
        </span>
        {estimated && <span className="text-faint">Months without a stored price use the last trade price.</span>}
      </div>
    </Card>
  );
}

function AllocationCard() {
  const { view } = useAllocation();
  const off = view.rows.filter((r) => r.status === "above" || r.status === "below");
  return (
    <Card title="Allocation" action={<Link to="/allocation" className="flex items-center text-xs font-medium text-accent">Details <IconChevron size={14} /></Link>}>
      {view.total === 0 ? (
        <p className="text-sm text-muted">Nothing to allocate yet.</p>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden>
            {view.rows.filter((r) => r.value > 0).map((r) => (
              <div key={r.assetClass} style={{ width: `${r.pct}%`, background: CLASS_COLOR[r.assetClass] }} />
            ))}
          </div>
          <ul className="mt-4 grid gap-2 text-sm">
            {view.rows
              .filter((r) => r.value > 0 || r.band)
              .map((r) => (
                <li key={r.assetClass} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CLASS_COLOR[r.assetClass] }} />
                  <span className="w-16">{CLASS_LABEL[r.assetClass]}</span>
                  <span className="num w-14 text-right font-medium">{formatPct(r.pct)}</span>
                  <span className="num text-xs text-faint">{r.band ? `target ${r.band.minPct}–${r.band.maxPct}%` : "no target"}</span>
                  {r.status === "above" && <Badge tone="warn">Above ▲</Badge>}
                  {r.status === "below" && <Badge tone="warn">Below ▼</Badge>}
                </li>
              ))}
          </ul>
          {off.length === 0 && <p className="mt-3 text-xs text-gain">✓ Every class is inside its band.</p>}
        </>
      )}
    </Card>
  );
}

function EmergencyCard() {
  const e = useEmergency();
  const { settings } = useData();
  const targetMonths = settings.emergencyMonths;
  const max = Math.max(targetMonths, e.totalMonths) * 1.05 || 1;
  return (
    <Card title="Emergency fund" action={<Link to="/settings#profile" className="text-xs font-medium text-accent">Set expenses</Link>}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="display text-3xl num">{e.instantMonths.toFixed(1)}</span>
          <span className="ml-1 text-sm text-muted">months instant</span>
        </div>
        <div className="text-right text-sm text-muted">
          target {targetMonths} mo · <Money p={e.target} compact />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Layer 1 · instant cash</span>
            <Money p={e.instant} />
          </div>
          <Meter value={e.instantMonths} max={max} label="Instant cash, months of expenses" marks={[{ at: targetMonths, label: "target" }]} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Layer 1 + 2 · incl. RD, FD, bonds (after penalties)</span>
            <span className="num">{e.totalMonths.toFixed(1)} mo</span>
          </div>
          <Meter value={e.totalMonths} max={max} tone="brass" label="All emergency layers, months of expenses" marks={[{ at: targetMonths, label: "target" }]} />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        {e.instantMonths >= targetMonths
          ? "✓ Instant cash alone covers your target."
          : e.totalMonths >= targetMonths
            ? `Instant cash is ${formatINR(Math.max(0, e.target - e.instant))} short; the second layer covers the rest.`
            : `Short by ${formatINR(Math.max(0, e.target - e.instant - e.second))} even counting slower assets.`}
      </p>
    </Card>
  );
}

function UpcomingCard() {
  const events = useUpcoming(90);
  const { asOf } = useData();
  const outflow = events.filter((e) => e.direction === "out").reduce((s, e) => s + (e.amount ?? 0), 0);
  const inflow = events.filter((e) => e.direction === "in").reduce((s, e) => s + (e.amount ?? 0), 0);
  return (
    <Card title="Next 90 days" action={<Link to="/calendar" className="flex items-center text-xs font-medium text-accent">Calendar <IconChevron size={14} /></Link>}>
      <div className="mb-3 flex gap-6 text-sm">
        <div>
          <div className="text-xs text-muted">Going out</div>
          <Money p={-outflow} className="font-medium" />
        </div>
        <div>
          <div className="text-xs text-muted">Coming in (est.)</div>
          <Money p={inflow} sign className="font-medium text-gain" />
        </div>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted">No scheduled SIPs, instalments or maturities.</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.slice(0, 7).map((e, i) => {
            const days = daysBetween(asOf, e.date);
            return (
              <li key={i} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted num">{days === 0 ? "Today" : days === 1 ? "Tomorrow" : formatDate(e.date, { year: false })}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {e.amount !== null && (
                  <span className={cx("num money shrink-0", e.direction === "in" ? "text-gain" : "")}>
                    {e.direction === "in" ? "+" : e.direction === "out" ? "−" : ""}
                    {formatINR(e.amount)}
                    {e.estimated ? "*" : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {events.length > 7 && <p className="mt-2 text-xs text-faint">+{events.length - 7} more · * estimated</p>}
    </Card>
  );
}

function AlertsCard() {
  const eq = useEquity();
  const { portfolio, asOf } = useData();
  const maturing = portfolio.holdings.filter((h) => h.maturity && !h.closed && h.maturity >= asOf && daysBetween(asOf, h.maturity) <= 45);
  const items: { tone: "warn" | "neutral"; title: string; detail?: string; to: string }[] = [];
  for (const h of maturing) items.push({ tone: "neutral", title: `${h.instrument.name} matures ${formatDate(h.maturity!)}`, detail: "Decide where the money goes: the allocation page suggests a split.", to: `/holdings/${h.instrument.id}` });
  if (portfolio.stalePrices.length) {
    items.push({
      tone: "warn",
      title: `${portfolio.stalePrices.length} holding${portfolio.stalePrices.length > 1 ? "s" : ""} without a recent price`,
      detail: portfolio.stalePrices.slice(0, 3).map((h) => h.instrument.name).join(", "),
      to: "/holdings",
    });
  }
  for (const f of eq.flags.slice(0, 4)) items.push({ tone: f.severity === "warn" ? "warn" : "neutral", title: f.title, detail: f.detail, to: "/allocation" });
  return (
    <Card title="Worth a look">
      {items.length === 0 ? (
        <p className="text-sm text-muted">✓ Nothing needs attention.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, 6).map((it, i) => (
            <li key={i}>
              <Link to={it.to} className="flex gap-3 rounded-xl p-2 hover:bg-sunken">
                <IconAlert size={16} className={cx("mt-0.5 shrink-0", it.tone === "warn" ? "text-warn" : "text-faint")} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{it.title}</span>
                  {it.detail && <span className="block truncate text-xs text-muted">{it.detail}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
