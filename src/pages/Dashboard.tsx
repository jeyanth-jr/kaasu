import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAdd } from "../App";
import { clearSampleData, loadSampleData } from "../db/sample";
import { daysBetween, formatDate, formatMonth, monthKey } from "../domain/dates";
import { formatCompact, formatINR, formatPct } from "../domain/money";
import { netWorthSeries } from "../domain/portfolio";
import { monthSummary, paydayStatus, safeToSpend } from "../domain/cashflow";
import { AnimatedMoney, Badge, Button, Callout, Card, EmptyState, IconTile, Meter, Money, PageHeader, Tabs, cx } from "../ui/components";
import { useCommitments } from "../ui/money";
import { PaydayBanner, SalarySetupSheet } from "./Money";
import { useData } from "../ui/data";
import { CLASS_COLOR, CLASS_LABEL, useAllocation, useEmergency, useEquity, useUpcoming } from "../ui/derived";
import { CategoryIcon } from "../ui/categoryIcons";
import { SavingsGoalCard } from "../ui/SavingsGoal";
import { IconAlert, IconBanknote, IconChevron, IconHand, IconReceiptPlain, IconRepeat, IconRocket, IconTrendUp, IconWallet } from "../ui/icons";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const data = useData();
  const { portfolio: pf, settings, instruments, ready, cash, asOf } = data;
  const { openAdd, openPayday, openMoney } = useAdd();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const hasSample = instruments.some((i) => i.sample);

  if (!ready) return <div className="py-20 text-center text-muted">Counting your kaasu…</div>;

  if (instruments.length === 0 && cash.length === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-6">
        <PageHeader title="Hey there" sub="Kaasu tracks your salary, spending and every investment you own, privately." />
        <EmptyState
          icon={<IconRocket size={34} className="text-accent" />}
          title="Let's get your money map going"
          action={
            <>
              <Button variant="primary" onClick={() => openMoney("expense")}>
                Log a spend
              </Button>
              <Button onClick={() => openAdd()}>Add an investment</Button>
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
                {busy ? "Loading…" : "Try with sample data"}
              </Button>
            </>
          }
        >
          Every buy, SIP, salary credit and chai is a dated entry. Net worth, XIRR, budgets and tax lots are all worked out from them.
          <span className="mt-2 block text-xs text-faint">Sample data is fictional, clearly marked, and clears in one tap.</span>
        </EmptyState>
      </div>
    );
  }

  const gainPct = pf.invested > 0 ? (pf.unrealized / pf.invested) * 100 : null;
  const dayPct = pf.dayChangeBase > 0 ? (pf.dayChange / pf.dayChangeBase) * 100 : null;
  const status = paydayStatus(settings.salary, cash, asOf);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Home</h1>
      <div>
        <div className="text-sm font-semibold text-muted">{formatDate(asOf)}</div>
        <div className="display text-3xl font-extrabold sm:text-4xl">
          {greeting()}{" "}
          <motion.span className="inline-block origin-[70%_70%]" animate={{ rotate: [0, 14, -8, 14, 0] }} transition={{ duration: 1.2, delay: 0.3 }}>
            <IconHand size={30} className="text-accent" />
          </motion.span>
        </div>
      </div>

      {hasSample && (
        <Callout tone="warn" icon={<Badge tone="warn">SAMPLE</Badge>} title="You're looking at sample data">
          <span>Everything marked sample is made up. </span>
          <button
            className="font-semibold text-ink underline underline-offset-2"
            onClick={async () => {
              if (confirm("Remove all sample holdings and entries? Your own data stays.")) await clearSampleData();
            }}
          >
            Clear sample data
          </button>
        </Callout>
      )}

      {(status.state === "due" || status.state === "not-set") && <PaydayBanner status={status} onOpen={openPayday} onSetup={() => setSetup(true)} />}

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="relative overflow-hidden rounded-[2rem] bg-hero p-5 shadow-card sm:p-7"
      >
        <div className="pointer-events-none absolute -top-10 -right-10 h-44 w-44 rounded-full bg-lime/30 blur-3xl" />
        <div className="relative">
          <div className="text-sm font-semibold text-white/80">Your net worth</div>
          <AnimatedMoney p={pf.netWorth} className="display mt-1 block text-[2.6rem] leading-none font-extrabold sm:text-6xl" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pf.dayChangeBase > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold backdrop-blur">
                {pf.dayChange >= 0 ? "▲" : "▼"} <span className="money">{formatINR(Math.abs(pf.dayChange))}</span> today ({formatPct(dayPct, { sign: true })})
              </span>
            )}
            {pf.xirr !== null && <span className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1 text-sm font-bold text-lime-ink">XIRR {formatPct(pf.xirr * 100, { sign: true })}</span>}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <HeroStat label="Invested" value={formatINR(pf.invested)} />
          <HeroStat label="Gain" value={`${pf.unrealized >= 0 ? "+" : "−"}${formatINR(Math.abs(pf.unrealized))}`} sub={gainPct === null ? undefined : formatPct(gainPct, { sign: true })} />
          <HeroStat label="In lakhs" value={formatCompact(pf.netWorth)} className="hidden sm:block" />
        </div>
        {!settings.includeCommitments && pf.commitmentsPaid > 0 && (
          <div className="relative mt-3 text-xs text-white/70">
            Excludes <Money p={pf.commitmentsPaid} /> paid into commitments outside the portfolio
          </div>
        )}
      </motion.section>

      <QuickActions />

      <SavingsGoalCard />

      <MoneySnapshot />

      <NetWorthChart />

      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationCard />
        <EmergencyCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <UpcomingCard />
        <AlertsCard />
      </div>
      {setup && <SalarySetupSheet onClose={() => setSetup(false)} />}
    </div>
  );
}

function QuickActions() {
  const { openMoney, openAdd } = useAdd();
  const tiles = [
    { label: "Spent", icon: IconReceiptPlain, color: "var(--loss)", onClick: () => openMoney("expense") },
    { label: "Got money", icon: IconBanknote, color: "var(--gain)", onClick: () => openMoney("income") },
    { label: "Invest", icon: IconTrendUp, color: "var(--accent)", onClick: () => openAdd() },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((t, i) => (
        <motion.button
          key={t.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 + i * 0.05 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.93 }}
          onClick={t.onClick}
          className="flex flex-col items-center gap-2 rounded-3xl border border-line/80 bg-surface px-2 py-3.5 text-xs font-bold shadow-card"
        >
          <IconTile color={t.color}>
            <t.icon size={20} />
          </IconTile>
          {t.label}
        </motion.button>
      ))}
      <Link to="/plans" className="contents">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.23 }}
          whileHover={{ y: -3 }}
          whileTap={{ scale: 0.93 }}
          className="flex flex-col items-center gap-2 rounded-3xl border border-line/80 bg-surface px-2 py-3.5 text-xs font-bold shadow-card"
        >
          <IconTile color="var(--c-gold)">
            <IconRepeat size={20} />
          </IconTile>
          Plans
        </motion.span>
      </Link>
    </div>
  );
}

function HeroStat({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={cx("rounded-2xl px-3 py-2.5 text-white", className)} style={{ background: "rgb(255 255 255 / 0.12)" }}>
      <div className="text-[11px] font-semibold text-white/75">{label}</div>
      <div className="money text-base font-extrabold whitespace-nowrap num">{value}</div>
      {sub && <div className="text-[11px] font-semibold text-white/80 num">{sub}</div>}
    </div>
  );
}

function MoneySnapshot() {
  const { cash, settings, asOf } = useData();
  const month = monthKey(asOf);
  const summary = useMemo(() => monthSummary(cash, month), [cash, month]);
  const commitments = useCommitments(month, summary.income || settings.salary?.amount || 0);
  const sts = safeToSpend({ summary, salary: settings.salary, committed: commitments.reduce((s, c) => s + c.amount, 0), today: asOf });
  if (cash.length === 0 && !settings.salary) return null;
  const top = summary.byCategory.slice(0, 3);
  return (
    <Link to="/money" className="block">
      <Card title="This month" icon={<IconWallet size={15} />} action={<span className="flex items-center text-xs font-semibold text-accent">Money <IconChevron size={14} /></span>}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-muted">Safe to spend</div>
            <div className={cx("display money text-3xl font-extrabold num", sts.left < 0 ? "text-loss" : "text-ink")}>{formatINR(sts.left)}</div>
            {sts.daysLeft > 0 && (
              <div className="text-xs text-muted">
                ≈ <span className="money">{formatINR(sts.perDay)}</span>/day · {sts.daysLeft} days left
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {top.map((c) => (
              <div key={c.category.id} className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2">
                <CategoryIcon id={c.category.id} size={18} />
                <span className="money text-sm font-bold num">{formatCompact(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Link>
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
          <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
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
          </ComposedChart>
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
