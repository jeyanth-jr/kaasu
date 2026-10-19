import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { saveSettings } from "../db/db";
import { budgetLines, categoryOf, CATEGORIES, monthSummary, paydayStatus, safeToSpend, savingsStreak, type CashEntry, type EntryKind } from "../domain/cashflow";
import { addMonthsToKey, formatDate, formatMonth, monthKey } from "../domain/dates";
import { formatCompact, formatINR, formatPct } from "../domain/money";
import { Badge, Button, Card, EmptyState, Field, IconTile, Meter, Money, PageHeader, Select, Sheet, cx } from "../ui/components";
import { AccountTag } from "../ui/accounts";
import { useData } from "../ui/data";
import { CategoryIcon } from "../ui/categoryIcons";
import { SavingsGoalCard } from "../ui/SavingsGoal";
import { IconBanknote, IconCalendarClock, IconCheckCircle, IconChevron, IconFlame, IconParty, IconPlus, IconTarget, IconUpload, IconWallet } from "../ui/icons";
import { MoneyInput, NumberInput } from "../ui/inputs";
import { useCommitments } from "../ui/money";
import { EntrySheet, PaydaySheet, StatementSheet } from "../ui/MoneySheets";

export function MoneyPage() {
  const { cash, settings, asOf } = useData();
  const [month, setMonth] = useState(monthKey(asOf));
  const [entrySheet, setEntrySheet] = useState<{ kind: EntryKind; entry?: CashEntry } | null>(null);
  const [payday, setPayday] = useState(false);
  const [params, setParams] = useSearchParams();
  const [statement, setStatementOpen] = useState(params.get("statement") === "1");
  useEffect(() => {
    if (params.get("statement") === "1") setStatementOpen(true);
  }, [params]);
  const setStatement = (open: boolean) => {
    setStatementOpen(open);
    if (!open && params.has("statement")) setParams({}, { replace: true });
  };
  const [budgets, setBudgets] = useState(false);
  const [salarySetup, setSalarySetup] = useState(false);

  const summary = useMemo(() => monthSummary(cash, month), [cash, month]);
  const isCurrent = month === monthKey(asOf);
  const salary = settings.salary;
  const commitments = useCommitments(month, summary.income || salary?.amount || 0);
  const committed = commitments.reduce((s, c) => s + c.amount, 0);
  const sts = safeToSpend({ summary, salary, committed, today: asOf });
  const lines = budgetLines(summary, settings.categoryBudgets);
  const status = paydayStatus(salary, cash, asOf);
  const streak = useMemo(() => savingsStreak(cash, asOf), [cash, asOf]);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const entries = useMemo(() => cash.filter((e) => monthKey(e.date) === month && (!catFilter || e.category === catFilter)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt))), [cash, month, catFilter]);
  const prev = useMemo(() => monthSummary(cash, addMonthsToKey(month, -1)), [cash, month]);
  const history = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const m = addMonthsToKey(monthKey(asOf), i - 5);
        const s = monthSummary(cash, m);
        return { month: m, income: s.income / 100, spent: s.expenses / 100 };
      }),
    [cash, asOf],
  );

  const empty = cash.length === 0 && !salary;

  return (
    <>
      <PageHeader
        title="Money"
        sub="Salary in, spending out, and what's safe to spend."
        action={
          <div className="flex gap-2">
            <Button onClick={() => setStatement(true)}>
              <IconUpload size={16} /> Statement
            </Button>
            <Button variant="primary" onClick={() => setEntrySheet({ kind: "expense" })}>
              <IconPlus size={16} /> Spent
            </Button>
          </div>
        }
      />

      {empty ? (
        <EmptyState
          icon={<IconWallet size={34} className="text-accent" />}
          title="Let's set up your money month"
          action={
            <>
              <Button variant="primary" onClick={() => setSalarySetup(true)}>
                <IconWallet size={16} /> Set up payday
              </Button>
              <Button onClick={() => setStatement(true)}>
                <IconUpload size={16} /> Import a statement
              </Button>
              <Button variant="ghost" onClick={() => setEntrySheet({ kind: "expense" })}>
                Log a spend
              </Button>
            </>
          }
        >
          Tell Kaasu your in-hand salary and payday. When it lands, one tap lines it up across SIPs, RD, EMIs and bills, and shows what's left to spend each day.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {isCurrent && <PaydayBanner status={status} onOpen={() => setPayday(true)} onSetup={() => setSalarySetup(true)} />}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setMonth(addMonthsToKey(month, -1))} aria-label="Previous month">
                <IconChevron size={16} className="rotate-180" />
              </Button>
              <span className="display min-w-28 text-center text-lg font-bold">{formatMonth(month)}</span>
              <Button size="sm" variant="ghost" onClick={() => setMonth(addMonthsToKey(month, 1))} disabled={isCurrent} aria-label="Next month">
                <IconChevron size={16} />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {streak > 0 && (
                <Badge tone="gold">
                  <IconFlame size={12} /> {streak}-month savings streak
                </Badge>
              )}
            </div>
          </div>

          {/* Safe to spend hero */}
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[2rem] bg-hero p-5 shadow-card sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white/80">{isCurrent ? "Safe to spend this month" : "Left over"}</div>
                <div className={cx("display money mt-1 text-5xl font-extrabold num sm:text-6xl", sts.left < 0 && "text-[#ffd0d8]")}>{formatINR(sts.left)}</div>
                {isCurrent && sts.daysLeft > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold text-white backdrop-blur">
                    ≈ <span className="money num">{formatINR(sts.perDay)}</span>/day for {sts.daysLeft} days
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-white sm:w-[26rem]">
                <HeroChip label={sts.incomeIsExpected ? "Salary (expected)" : "Income"} value={sts.income} />
                <HeroChip label="Committed" value={sts.committed} />
                <HeroChip label="Spent" value={sts.spent} />
              </div>
            </div>
            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/20">
              <motion.div
                className="h-full rounded-full bg-gold"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, sts.income - sts.committed > 0 ? (sts.spent / (sts.income - sts.committed)) * 100 : 100)}%` }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs font-medium text-white/75">
              <span>spent of spendable</span>
              <span>savings rate {summary.savingsRate === null ? "—" : formatPct(summary.savingsRate * 100, { decimals: 0 })}</span>
            </div>
          </motion.section>

          <SavingsGoalCard />

          <div className="grid gap-4 lg:grid-cols-5">
            <Card
              title="Budgets"
              icon={<IconTarget size={15} />}
              className="lg:col-span-3"
              action={
                <Button size="sm" variant="ghost" onClick={() => setBudgets(true)}>
                  Edit
                </Button>
              }
            >
              {lines.length === 0 ? (
                <p className="text-sm text-muted">No spending yet this month. Set budgets to see how each category is tracking.</p>
              ) : (
                <ul className="flex flex-col gap-3.5">
                  {lines.map((l) => (
                    <li
                      key={l.category.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={catFilter === l.category.id}
                      onClick={() => setCatFilter(catFilter === l.category.id ? null : l.category.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setCatFilter(catFilter === l.category.id ? null : l.category.id)}
                      className={cx("-mx-2 flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors hover:bg-sunken/70", catFilter === l.category.id && "bg-accent-soft/60 ring-1 ring-accent/40")}
                    >
                      <IconTile color={l.category.color}>
                        <CategoryIcon id={l.category.id} />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate font-semibold">{l.category.label}</span>
                          <span className="shrink-0 text-xs text-muted num">
                            <span className={cx("money font-bold", l.status === "over" ? "text-loss" : "text-ink")}>{formatINR(l.spent)}</span>
                            {l.budget > 0 ? <span className="money"> / {formatCompact(l.budget)}</span> : <span> · no budget</span>}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter value={l.spent} max={l.budget || l.spent || 1} size="sm" tone={l.status === "over" ? "loss" : l.status === "near" ? "warn" : l.status === "none" ? "brass" : "accent"} label={`${l.category.label} budget used`} />
                        </div>
                        {l.status === "over" && <div className="mt-1 text-[11px] font-semibold text-loss">Over by {formatINR(l.spent - l.budget)}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Spend pace" className="lg:col-span-2">
              <SpendPace current={summary.dailyCumulative} previous={prev.dailyCumulative} isCurrent={isCurrent} today={Number(asOf.slice(8))} />
              <div className="mt-2 flex gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded bg-accent" /> {formatMonth(month).split(" ")[0]}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t-2 border-dashed border-faint" /> last month
                </span>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card title={catFilter ? `${categoryOf(catFilter).label} · ${entries.length}` : `Entries · ${entries.length}`} className="lg:col-span-3" pad={false} action={<span className="flex gap-1">{catFilter && <Button size="sm" variant="secondary" onClick={() => setCatFilter(null)}>Show all ✕</Button>}<Button size="sm" variant="ghost" onClick={() => setEntrySheet({ kind: "income" })}>+ Income</Button></span>}>
              {entries.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted">Nothing logged for {formatMonth(month)}.</p>
              ) : (
                <EntryList entries={entries} onOpen={(e) => setEntrySheet({ kind: e.kind, entry: e })} />
              )}
            </Card>
            <Card title="Last 6 months" className="lg:col-span-2">
              <div className="money h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={history} barGap={3}>
                    <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m).slice(0, 3)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: "var(--sunken)" }}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, fontSize: 12 }}
                      labelFormatter={(m) => formatMonth(String(m))}
                      formatter={(v, n) => [formatINR(Math.round(Number(v) * 100)), n === "income" ? "Income" : "Spent"]}
                    />
                    <Bar dataKey="income" fill="var(--gain)" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="spent" fill="var(--accent)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-gain" /> Income</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Spent</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      <EntrySheet open={!!entrySheet} onClose={() => setEntrySheet(null)} kind={entrySheet?.kind} entry={entrySheet?.entry} />
      <PaydaySheet open={payday} onClose={() => setPayday(false)} />
      <StatementSheet open={statement} onClose={() => setStatement(false)} />
      {budgets && <BudgetsSheet onClose={() => setBudgets(false)} />}
      {salarySetup && <SalarySetupSheet onClose={() => setSalarySetup(false)} />}
    </>
  );
}

function HeroChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/12 px-3 py-2 backdrop-blur" style={{ background: "rgb(255 255 255 / 0.12)" }}>
      <div className="text-[11px] font-semibold text-white/75">{label}</div>
      <div className="money text-sm font-extrabold num">{formatCompact(value)}</div>
    </div>
  );
}

export function PaydayBanner({ status, onOpen, onSetup }: { status: ReturnType<typeof paydayStatus>; onOpen: () => void; onSetup: () => void }) {
  if (status.state === "not-set") {
    return (
      <button onClick={onSetup} className="flex items-center gap-3 rounded-3xl border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-3 text-left">
        <IconCalendarClock size={24} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Set your payday</span>
          <span className="block text-xs text-muted">Get a nudge when salary lands, with a plan for every rupee.</span>
        </span>
        <IconChevron size={18} className="text-muted" />
      </button>
    );
  }
  if (status.state === "due") {
    return (
      <motion.button
        onClick={onOpen}
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-3 rounded-3xl bg-gold px-4 py-3.5 text-left text-gold-ink shadow-card"
      >
        <motion.span animate={{ rotate: [0, -12, 12, -6, 0] }} transition={{ repeat: Infinity, repeatDelay: 2.5, duration: 0.6 }} className="text-3xl">
          <IconBanknote size={30} />
        </motion.span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold">Payday! Did your salary land?</span>
          <span className="block text-xs font-semibold opacity-75">Expected {formatDate(status.expectedOn, { year: false })}. Tap to confirm and plan it out.</span>
        </span>
        <IconParty size={20} />
      </motion.button>
    );
  }
  if (status.state === "upcoming") {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3 text-sm shadow-card">
        <span className="text-2xl">⏳</span>
        <span>
          Payday in <b>{status.daysLeft} day{status.daysLeft === 1 ? "" : "s"}</b> ({formatDate(status.expectedOn, { year: false })}). Hang in there.
        </span>
      </div>
    );
  }
  return (
    <button onClick={onOpen} className="flex items-center gap-3 rounded-3xl border border-gain/30 bg-gain-soft px-4 py-3 text-left">
      <IconCheckCircle size={24} className="shrink-0 text-gain" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">
          Salary in · <span className="money">{formatINR(status.amount)}</span> on {formatDate(status.on, { year: false })}
        </span>
        <span className="block text-xs text-muted">Open the payday checklist</span>
      </span>
      <IconChevron size={18} className="text-muted" />
    </button>
  );
}

function SpendPace({ current, previous, isCurrent, today }: { current: number[]; previous: number[]; isCurrent: boolean; today: number }) {
  const days = Math.max(current.length, previous.length);
  const data = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    cur: !isCurrent || i < today ? (current[i] ?? current[current.length - 1] ?? 0) / 100 : undefined,
    prev: (previous[i] ?? previous[previous.length - 1] ?? 0) / 100,
  }));
  return (
    <div className="money h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <XAxis dataKey="day" tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} interval={6} />
          <YAxis tickFormatter={(v: number) => formatCompact(v * 100)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, fontSize: 12 }}
            labelFormatter={(d) => `Day ${d}`}
            formatter={(v, n) => [formatINR(Math.round(Number(v) * 100)), n === "cur" ? "This month" : "Last month"]}
          />
          <Line type="monotone" dataKey="prev" stroke="var(--faint)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="cur" stroke="var(--accent)" strokeWidth={2.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EntryList({ entries, onOpen }: { entries: CashEntry[]; onOpen: (e: CashEntry) => void }) {
  let lastDate = "";
  return (
    <ul className="pb-2">
      {entries.slice(0, 300).map((e) => {
        const cat = categoryOf(e.category);
        const header = e.date !== lastDate;
        lastDate = e.date;
        return (
          <li key={e.id}>
            {header && <div className="px-5 pt-3 pb-1 text-[11px] font-bold tracking-wider text-faint uppercase">{formatDate(e.date, { year: false })}</div>}
            <button onClick={() => onOpen(e)} className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-sunken/60">
              <IconTile color={cat.color}>
                <CategoryIcon id={cat.id} />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{e.note || cat.label}</span>
                <span className="block text-xs text-muted">
                  {cat.label}
                  {e.source === "statement" && " · statement"}
                </span>
                {e.accountId && (
                  <span className="mt-0.5 block">
                    <AccountTag id={e.accountId} />
                  </span>
                )}
              </span>
              <Money p={e.kind === "income" ? e.amount : -e.amount} sign={e.kind === "income"} className={cx("text-sm font-bold", e.kind === "income" && "text-gain")} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BudgetsSheet({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const [b, setB] = useState<Record<string, number>>({ ...settings.categoryBudgets });
  const total = Object.values(b).reduce((s, x) => s + (x || 0), 0);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Monthly budgets"
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            await saveSettings({ categoryBudgets: Object.fromEntries(Object.entries(b).filter(([, v]) => v > 0)) });
            onClose();
          }}
        >
          Save budgets
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Total <b className="money text-ink">{formatINR(total)}</b> a month. Leave a category empty for no budget.
      </p>
      <ul className="flex flex-col gap-2">
        {CATEGORIES.filter((c) => c.kind === "expense").map((c) => (
          <li key={c.id} className="flex items-center gap-3">
            <IconTile color={c.color}>
              <CategoryIcon id={c.id} />
            </IconTile>
            <span className="min-w-0 flex-1 text-sm font-semibold">{c.label}</span>
            <div className="w-36">
              <MoneyInput value={b[c.id] ?? null} onChange={(p) => setB({ ...b, [c.id]: p ?? 0 })} placeholder="—" />
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(20_000_00, (b[c.id] ?? 0) * 2)}
              step={500_00}
              value={b[c.id] ?? 0}
              onChange={(e) => setB({ ...b, [c.id]: Number(e.target.value) })}
              aria-label={`${c.label} budget`}
              className="hidden w-24 accent-[var(--accent)] sm:block"
            />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function SalarySetupSheet({ onClose }: { onClose: () => void }) {
  const { settings, instruments } = useData();
  const accounts = instruments.filter((i) => i.kind === "cash" && !i.archived);
  const [amount, setAmount] = useState<number | null>(settings.salary?.amount ?? null);
  const [day, setDay] = useState<number | null>(settings.salary?.day ?? 1);
  const [accountId, setAccountId] = useState(settings.salary?.accountId ?? "");
  const [employer, setEmployer] = useState(settings.salary?.employer ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title="Your payday"
      footer={
        <>
          {settings.salary && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                await saveSettings({ salary: undefined });
                onClose();
              }}
            >
              Turn off
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!amount || !day}
            onClick={async () => {
              await saveSettings({ salary: { amount: amount!, day: Math.max(1, Math.min(31, day!)), accountId: accountId || undefined, employer: employer.trim() || undefined } });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="In-hand salary (after tax, PF)">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        <Field label="Usually credited on day" hint="Weekend paydays move to the Friday before">
          {(id) => <NumberInput id={id} value={day} onChange={(n) => setDay(n === null ? null : Math.round(n))} />}
        </Field>
        <Field label="Credited into">
          {(id) => (
            <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Not tracked</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Employer (optional)">{(id) => <input id={id} className="w-full rounded-2xl border border-line bg-paper/60 px-3.5 py-2.5 text-sm" value={employer} onChange={(e) => setEmployer(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-xs text-faint">Kaasu can't read your bank account. On payday it asks you to confirm, which takes one tap.</p>
    </Sheet>
  );
}
