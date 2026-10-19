import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAdd } from "../App";
import { db } from "../db/db";
import { daysBetween, formatDate, formatMonth, monthKey } from "../domain/dates";
import { formatCompact, formatINR, formatPct } from "../domain/money";
import {
  LOAN_KIND_LABEL,
  buildSchedules,
  debtSummary,
  endingEvents,
  loanStatus,
  monthlyLadder,
  prepaymentImpact,
  scheduleTotals,
  type LoanStatus,
  type ScheduleItem,
  type ScheduleKind,
} from "../domain/obligations";
import type { Liability } from "../domain/types";
import { AnimatedMoney, Badge, Button, Callout, Card, EmptyState, IconTile, Meter, Money, PageHeader, Tabs, cx } from "../ui/components";
import { useData } from "../ui/data";
import { IconCalendarClock, IconChevron, IconFlag, IconHourglass, IconIdea, IconPause, IconPlus } from "../ui/icons";
import { MoneyInput } from "../ui/inputs";
import { KIND_STYLE, LOAN_ICON } from "../ui/planStyle";
import { LoanSheet, NewPlanSheet } from "../ui/PlanSheets";
import { SipDueCard } from "../ui/SipDue";

const KINDS: ScheduleKind[] = ["sip", "rd", "chit", "commitment", "emi"];

export function PlansPage() {
  const { instruments, txns, liabilities, asOf, settings } = useData();
  const [tab, setTab] = useState<"schedules" | "debt">("schedules");
  const [newPlan, setNewPlan] = useState<"sip" | "rd" | "chit" | "loan" | "pick" | null>(null);
  const [editLoan, setEditLoan] = useState<Liability | null>(null);

  const items = useMemo(() => buildSchedules({ instruments, txns, liabilities, asOf }), [instruments, txns, liabilities, asOf]);
  const statuses = useMemo(() => liabilities.map((l) => loanStatus(l, asOf)), [liabilities, asOf]);
  const totals = useMemo(() => scheduleTotals(items), [items]);
  const freed = useMemo(() => endingEvents(items, asOf), [items, asOf]);
  const debt = useMemo(() => debtSummary(statuses, settings.salary?.amount), [statuses, settings.salary]);
  const next = freed[0];

  return (
    <>
      <PageHeader
        title="Plans & debt"
        sub="Every monthly commitment, how long it runs, and what's left to pay."
        action={
          <Button variant="primary" onClick={() => setNewPlan("pick")}>
            <IconPlus size={16} /> New plan
          </Button>
        }
      />

      <div className="mb-4 empty:hidden">
        <SipDueCard />
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No monthly plans yet"
          icon={<IconCalendarClock size={40} className="text-accent" />}
          action={
            <>
              <Button variant="primary" onClick={() => setNewPlan("sip")}>
                Add a SIP
              </Button>
              <Button onClick={() => setNewPlan("rd")}>Add an RD</Button>
              <Button onClick={() => setNewPlan("chit")}>Add a gold chit</Button>
              <Button onClick={() => setNewPlan("loan")}>Add a loan / EMI</Button>
            </>
          }
        >
          Set up SIPs, recurring deposits, gold chits and EMIs once. Kaasu shows each one's duration, instalments left, and when the money frees up.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2rem] bg-hero p-5 shadow-card sm:p-7">
            <div className="pointer-events-none absolute -top-10 -right-10 h-44 w-44 rounded-full bg-gold/30 blur-3xl" />
            <div className="relative">
              <div className="text-sm font-semibold text-white/80">Committed every month</div>
              <AnimatedMoney p={totals.monthlyTotal} className="display mt-1 block text-5xl leading-none font-extrabold" />
              <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
                <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                  <span className="money">{formatINR(totals.savingPerMonth)}</span> building wealth
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                  <span className="money">{formatINR(totals.debtPerMonth)}</span> to lenders
                </span>
                <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
                  <span className="money">{formatINR(totals.remainingTotal)}</span> still to pay (fixed plans)
                </span>
              </div>
              {next && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl bg-gold px-3.5 py-2 text-sm font-bold text-gold-ink">
                  <IconFlag size={16} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="money">{formatINR(next.freed)}</span> a month frees up after {formatDate(next.date)}
                    <span className="block text-xs font-semibold opacity-75">{next.item.name} ends</span>
                  </span>
                </div>
              )}
            </div>
          </motion.section>

          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "schedules", label: `Schedules · ${totals.activeCount}` },
              { value: "debt", label: `Debt · ${debt.active.length}` },
            ]}
          />

          {tab === "schedules" ? (
            <SchedulesTab items={items} freed={freed} onEditLoan={(id) => setEditLoan(liabilities.find((l) => l.id === id) ?? null)} />
          ) : (
            <DebtTab statuses={statuses} debt={debt} asOf={asOf} onEdit={setEditLoan} onAdd={() => setNewPlan("loan")} />
          )}
        </div>
      )}

      <NewPlanSheet open={newPlan !== null} start={newPlan && newPlan !== "pick" ? newPlan : undefined} onClose={() => setNewPlan(null)} />
      {editLoan && <LoanSheet open loan={editLoan} onClose={() => setEditLoan(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Schedules

function SchedulesTab({ items, freed, onEditLoan }: { items: ScheduleItem[]; freed: ReturnType<typeof endingEvents>; onEditLoan: (id: string) => void }) {
  const { asOf } = useData();
  const [showDone, setShowDone] = useState(false);
  const live = items.filter((i) => i.state !== "done");
  const done = items.filter((i) => i.state === "done");
  const ladder = useMemo(
    () =>
      monthlyLadder(items, monthKey(asOf), 18).map((m) => ({
        month: m.month,
        ...Object.fromEntries(KINDS.map((k) => [k, m.byKind[k] / 100])),
      })),
    [items, asOf],
  );
  const used = KINDS.filter((k) => items.some((i) => i.kind === k && i.state !== "done"));

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-3 lg:col-span-3">
        <AnimatePresence initial={false}>
          {live.map((it, i) => (
            <motion.div key={it.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
              <ScheduleCard item={it} onEditLoan={onEditLoan} />
            </motion.div>
          ))}
        </AnimatePresence>
        {done.length > 0 && (
          <div>
            <button onClick={() => setShowDone((s) => !s)} className="text-sm font-semibold text-muted hover:text-ink">
              {showDone ? "Hide" : "Show"} {done.length} finished
            </button>
            {showDone && (
              <div className="mt-2 flex flex-col gap-3 opacity-70">
                {done.map((it) => (
                  <ScheduleCard key={it.id} item={it} onEditLoan={onEditLoan} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card title="Monthly load, next 18 months" icon={<IconHourglass size={15} />}>
          <div className="money h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ladder} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
                <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m).slice(0, 3)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tickFormatter={(v: number) => formatCompact(v * 100)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                <Tooltip
                  cursor={{ fill: "var(--sunken)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, fontSize: 12 }}
                  labelFormatter={(m) => formatMonth(String(m))}
                  formatter={(v, n) => [formatINR(Math.round(Number(v) * 100)), KIND_STYLE[n as ScheduleKind]?.label ?? String(n)]}
                />
                {used.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={KIND_STYLE[k].chart} radius={i === used.length - 1 ? [6, 6, 0, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {used.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_STYLE[k].chart }} /> {KIND_STYLE[k].label}
              </span>
            ))}
          </div>
        </Card>

        <Card title="What frees up when" icon={<IconFlag size={15} />}>
          {freed.length === 0 ? (
            <p className="text-sm text-muted">Everything you've set up is open-ended.</p>
          ) : (
            <ol className="relative ml-2 flex flex-col gap-4 border-l-2 border-line pl-5">
              {freed.map((f) => {
                const st = KIND_STYLE[f.item.kind];
                return (
                  <li key={f.item.id} className="relative">
                    <span className="absolute top-1 -left-[1.72rem] grid h-4 w-4 place-items-center rounded-full ring-4 ring-surface" style={{ background: st.color }} />
                    <div className="text-sm font-bold">{formatDate(f.date)}</div>
                    <div className="text-xs text-muted">
                      {f.item.name} ends · {f.daysAway <= 0 ? "today" : `in ${f.daysAway} days`}
                    </div>
                    <div className="mt-0.5 text-sm">
                      <Money p={f.freed} className="font-semibold text-gain" /> <span className="text-muted">a month freed</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function ScheduleCard({ item, onEditLoan }: { item: ScheduleItem; onEditLoan: (id: string) => void }) {
  const { openAdd } = useAdd();
  const { instrumentById, asOf } = useData();
  const st = KIND_STYLE[item.kind];
  const Icon = st.icon;
  const inst = item.instrumentId ? instrumentById.get(item.instrumentId) : undefined;
  const isSip = inst?.details.kind === "mf" && !!inst.details.sip && !inst.details.sip.end;
  const left = item.remainingCount;

  const stateBadge =
    item.state === "ending-soon" ? <Badge tone="gold">Ending soon</Badge> : item.state === "upcoming" ? <Badge tone="accent">Starts {formatDate(item.start)}</Badge> : item.state === "done" ? <Badge>Finished</Badge> : item.state === "open-ended" ? <Badge>Open-ended</Badge> : null;

  return (
    <Card className="p-0">
      <div className="flex items-start gap-3">
        <IconTile color={st.color} className="h-11 w-11">
          <Icon size={20} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-bold">{item.name}</span>
            {stateBadge}
          </div>
          <div className="text-xs text-muted">
            {st.label}
            {item.subtitle ? ` · ${item.subtitle}` : ""}
          </div>
        </div>
        <div className="text-right">
          <Money p={item.amount} className="text-base font-extrabold" />
          <div className="text-[11px] text-muted">on the {ordinal(item.day)} · monthly</div>
        </div>
      </div>

      <div className="mt-4">
        {item.progress !== null ? (
          <>
            <Meter value={item.dueCount} max={item.totalCount ?? 1} size="sm" label={`${item.name} instalments paid`} tone={item.state === "ending-soon" ? "gold" : "accent"} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
              <span>
                <b className="text-ink num">
                  {item.dueCount} of {item.totalCount}
                </b>{" "}
                done · <b className="text-ink num">{left}</b> left
              </span>
              <span>{item.state === "done" ? `Ended ${formatDate(item.end!)}` : `Ends ${formatDate(item.end!)}`}</span>
            </div>
            {item.remainingAmount !== null && item.remainingAmount > 0 && (
              <div className="mt-1 text-xs text-muted">
                <Money p={item.remainingAmount} className="font-semibold text-ink" /> still to {item.isSaving ? "put in" : "pay"}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              Running since {formatDate(item.start)} · <b className="text-ink num">{item.dueCount}</b> instalments so far
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.nextDate && item.state !== "upcoming" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-xs font-semibold">
            <IconCalendarClock size={13} /> Next {formatDate(item.nextDate, { year: false })} · {daysBetween(asOf, item.nextDate)} days
          </span>
        )}
        {item.unrecorded !== null && item.unrecorded > 0 && item.state !== "upcoming" && (
          <button onClick={() => openAdd({ instrumentId: item.instrumentId })} className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn">
            {item.unrecorded} instalment{item.unrecorded === 1 ? "" : "s"} not recorded · Record
          </button>
        )}
        <span className="ml-auto flex gap-1">
          {isSip && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!inst || inst.details.kind !== "mf" || !inst.details.sip) return;
                if (confirm(`Stop the SIP in ${inst.name}? Past instalments stay on record.`)) await db.instruments.put({ ...inst, details: { ...inst.details, sip: { ...inst.details.sip, end: asOf } } });
              }}
            >
              <IconPause size={13} /> Stop SIP
            </Button>
          )}
          {item.liabilityId ? (
            <Button size="sm" variant="ghost" onClick={() => onEditLoan(item.liabilityId!)}>
              Edit
            </Button>
          ) : (
            item.instrumentId && (
              <Link to={`/holdings/${item.instrumentId}`}>
                <Button size="sm" variant="ghost">
                  Open <IconChevron size={13} />
                </Button>
              </Link>
            )
          )}
        </span>
      </div>
    </Card>
  );
}

function ordinal(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]!);
}

// ---------------------------------------------------------------------------
// Debt

function DebtTab({ statuses, debt, asOf, onEdit, onAdd }: { statuses: LoanStatus[]; debt: ReturnType<typeof debtSummary>; asOf: string; onEdit: (l: Liability) => void; onAdd: () => void }) {
  const finished = statuses.filter((s) => s.remainingCount === 0);
  const dti = debt.emiToIncome;
  const dtiLevel = dti === null ? null : dti < 0.3 ? { label: "Comfortable", tone: "gain" as const } : dti <= 0.4 ? { label: "Watch it", tone: "warn" as const } : { label: "Heavy", tone: "loss" as const };
  const top = debt.avalanche[0];
  const second = debt.avalanche[1];

  if (statuses.length === 0) {
    return (
      <EmptyState title="No loans tracked" icon={<IconFlag size={40} className="text-accent" />} action={<Button variant="primary" onClick={onAdd}>Add a loan / EMI</Button>}>
        Add home, car, personal or no-cost EMIs to see what you owe, when you'll be debt-free, and what prepaying would save.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="You owe" value={<Money p={debt.outstanding} />} sub={debt.unknownBalanceCount ? `+ ${debt.unknownBalanceCount} loan${debt.unknownBalanceCount > 1 ? "s" : ""} without a balance` : "principal outstanding"} />
        <StatCard label="EMIs / month" value={<Money p={debt.monthlyEmi} />} sub={`${debt.active.length} active loan${debt.active.length === 1 ? "" : "s"}`} />
        <StatCard label="Debt-free" value={debt.debtFreeDate ? formatDate(debt.debtFreeDate) : "—"} sub={debt.debtFreeDate ? `in ${Math.max(0, Math.round(daysBetween(asOf, debt.debtFreeDate) / 30.4))} months` : "needs full loan details"} />
        <StatCard label="Interest still to pay" value={<Money p={debt.interestRemaining} />} sub="on loans with details" />
      </div>

      {dti !== null && dtiLevel && (
        <Card title="EMI burden vs salary" icon={<IconHourglass size={15} />}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="display text-3xl font-extrabold num">{formatPct(dti * 100, { decimals: 0 })}</span>
            <Badge tone={dtiLevel.tone}>{dtiLevel.label}</Badge>
          </div>
          <div className="relative mt-3">
            <Meter value={dti * 100} max={60} tone={dtiLevel.tone === "gain" ? "gain" : dtiLevel.tone === "warn" ? "warn" : "loss"} label="EMIs as a share of salary" marks={[{ at: 30, label: "30%" }, { at: 40, label: "40%" }]} />
            <div className="mt-1 flex justify-between text-[11px] text-faint">
              <span>0%</span>
              <span>30%</span>
              <span>40%</span>
              <span>60%</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Lenders typically like total EMIs under about 40% of take-home pay; under 30% leaves room for saving.</p>
        </Card>
      )}

      {top && second && (
        <Callout tone="accent" icon={<IconIdea size={18} className="text-accent" />} title={`Extra money works hardest on ${top.loan.name}`}>
          It costs {top.loan.ratePct}% a year, against {second.loan.ratePct}% on {second.loan.name}. Clearing the highest rate first saves the most interest.
        </Callout>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {statuses
          .filter((s) => s.remainingCount > 0)
          .map((s) => (
            <LoanCard key={s.loan.id} s={s} asOf={asOf} onEdit={() => onEdit(s.loan)} />
          ))}
      </div>

      {finished.length > 0 && (
        <p className="text-xs text-muted">
          Paid off: {finished.map((f) => f.loan.name).join(", ")}.{" "}
          {finished.map((f) => (
            <button key={f.loan.id} className="font-semibold text-accent" onClick={() => onEdit(f.loan)}>
              Edit {f.loan.name}{" "}
            </button>
          ))}
        </p>
      )}
      <div>
        <Button onClick={onAdd}>
          <IconPlus size={15} /> Add another loan
        </Button>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-3xl border border-line/80 bg-surface p-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="display mt-1 text-xl font-extrabold num sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function LoanCard({ s, asOf, onEdit }: { s: LoanStatus; asOf: string; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const l = s.loan;
  const Icon = LOAN_ICON[l.kind ?? "other"];
  const amortized = s.mode === "amortized";

  return (
    <Card className="p-0">
      <div className="flex items-start gap-3">
        <IconTile color="var(--loss)" className="h-11 w-11">
          <Icon size={20} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{l.name}</div>
          <div className="text-xs text-muted">
            {l.kind ? LOAN_KIND_LABEL[l.kind] : "Loan"}
            {l.ratePct !== undefined && ` · ${l.ratePct === 0 ? "no-cost" : `${l.ratePct}% p.a.`}`}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>

      <div className="mt-4">
        <Meter value={s.progress * 100} max={100} size="sm" tone="gain" label={`${l.name} repaid`} />
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{amortized ? <>Repaid <b className="text-ink num">{formatPct(s.progress * 100, { decimals: 0 })}</b></> : <>{s.paidCount} EMIs paid</>}</span>
          <span>{s.payoffDate ? `Clears ${formatDate(s.payoffDate)}` : ""}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label={amortized ? "Outstanding" : "Left to pay"} value={<Money p={amortized ? (s.outstanding ?? 0) : s.remainingPayable} compact />} />
        <Mini label="EMI" value={<Money p={l.emi} compact />} />
        <Mini label="EMIs left" value={<span className="num">{s.remainingCount}{s.totalCount ? ` / ${s.totalCount}` : ""}</span>} />
      </div>

      {amortized ? (
        <button onClick={() => setOpen((o) => !o)} className="mt-3 flex w-full items-center justify-between rounded-2xl bg-sunken px-3 py-2 text-xs font-semibold">
          <span>
            Interest paid <span className="money">{formatINR(s.interestPaid ?? 0)}</span> · to come <span className="money">{formatINR(s.interestRemaining ?? 0)}</span>
          </span>
          <IconChevron size={14} className={cx("transition-transform", open && "rotate-90")} />
        </button>
      ) : (
        <p className="mt-3 text-xs text-faint">Add the amount borrowed, rate and start date (Edit) to see your balance, interest and prepayment savings.</p>
      )}

      <AnimatePresence initial={false}>
        {open && amortized && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <LoanDetail s={s} asOf={asOf} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-sunken px-2 py-2">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-extrabold">{value}</div>
    </div>
  );
}

function LoanDetail({ s, asOf }: { s: LoanStatus; asOf: string }) {
  const [extra, setExtra] = useState(0);
  const [lump, setLump] = useState<number | null>(null);
  const max = Math.max(50_000_00, s.loan.emi * 2);
  const impact = prepaymentImpact(s, asOf, { extraMonthly: extra, lump: lump ?? 0 });
  const rows = s.rows.map((r) => ({ date: r.date, balance: r.balance / 100 }));
  const todayRow = s.rows.filter((r) => r.date <= asOf).at(-1)?.date;
  const touched = extra > 0 || (lump ?? 0) > 0;

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-line pt-3">
      <div>
        <div className="mb-1 text-xs font-semibold text-muted">Balance over time</div>
        <div className="money h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`bal-${s.loan.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--loss)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--loss)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tickFormatter={(d: string) => formatMonth(monthKey(d)).slice(0, 3) + " " + d.slice(2, 4)} tick={{ fill: "var(--faint)", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={30} />
              <YAxis tickFormatter={(v: number) => formatCompact(v * 100)} tick={{ fill: "var(--faint)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, fontSize: 12 }} labelFormatter={(d) => formatDate(String(d))} formatter={(v) => [formatINR(Math.round(Number(v) * 100)), "Balance"]} />
              {todayRow && <ReferenceLine x={todayRow} stroke="var(--accent)" strokeDasharray="4 3" label={{ value: "Today", fill: "var(--accent)", fontSize: 10, position: "insideTopRight" }} />}
              <Area type="monotone" dataKey="balance" stroke="var(--loss)" strokeWidth={2} fill={`url(#bal-${s.loan.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-line p-3">
        <div className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">What if I pay extra?</div>
        <label className="block text-xs font-semibold text-muted">
          Extra every month: <b className="money text-ink">{formatINR(extra)}</b>
          <input type="range" min={0} max={max} step={500_00} value={extra} onChange={(e) => setExtra(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" aria-label="Extra monthly payment" />
        </label>
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-muted">One-time prepayment today</div>
          <MoneyInput value={lump} onChange={setLump} placeholder="0" />
        </div>
        {impact && touched ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-gain-soft px-2 py-2.5">
              <div className="text-[11px] font-semibold text-gain">Interest saved</div>
              <div className="money text-base font-extrabold text-gain num">{formatINR(impact.interestSaved)}</div>
            </div>
            <div className="rounded-2xl bg-gain-soft px-2 py-2.5">
              <div className="text-[11px] font-semibold text-gain">Done sooner by</div>
              <div className="text-base font-extrabold text-gain num">
                {impact.monthsSaved} month{impact.monthsSaved === 1 ? "" : "s"}
              </div>
            </div>
            <div className="col-span-2 text-xs text-muted">{impact.newPayoffDate && <>New payoff: <b className="text-ink">{formatDate(impact.newPayoffDate)}</b> instead of {s.payoffDate && formatDate(s.payoffDate)}.</>}</div>
          </motion.div>
        ) : (
          <p className="mt-3 text-xs text-faint">Slide or enter an amount to see the saving.</p>
        )}
        <p className="mt-2 text-[11px] text-faint">Check your lender's prepayment charges: many floating-rate loans have none, fixed-rate ones often do.</p>
      </div>
    </div>
  );
}
