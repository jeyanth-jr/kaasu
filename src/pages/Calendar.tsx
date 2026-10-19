import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { db, newId } from "../db/db";
import { addDays, addMonthsToKey, formatDate, formatMonth, isValidISO, monthEnd, monthKey, monthStart, todayISO } from "../domain/dates";
import { formatCompact, formatINR } from "../domain/money";
import { calendarEvents, defaultPlan, planView, type CalEvent } from "../domain/schedule";
import type { Liability, MonthlyPlan, PlanCategory, PlanLine } from "../domain/types";
import { Badge, Button, Card, Field, Input, Money, PageHeader, Select, Sheet, Tabs, cx } from "../ui/components";
import { useData } from "../ui/data";
import { IconChevron, IconPlus, IconTrash } from "../ui/icons";
import { MoneyInput, NumberInput } from "../ui/inputs";

export function CalendarPage() {
  const [tab, setTab] = useState<"agenda" | "month" | "plan">("agenda");
  return (
    <>
      <PageHeader
        title="Calendar"
        sub="Maturities, coupons, SIPs, instalments and EMIs"
        action={<Tabs value={tab} onChange={setTab} options={[{ value: "agenda", label: "Agenda" }, { value: "month", label: "Month" }, { value: "plan", label: "Monthly plan" }]} />}
      />
      {tab === "agenda" && <Agenda />}
      {tab === "month" && <MonthGrid />}
      {tab === "plan" && <PlanView />}
      {tab !== "plan" && <Liabilities />}
    </>
  );
}

const KIND_TONE: Record<CalEvent["kind"], string> = {
  sip: "SIP",
  rd: "RD",
  "rd-maturity": "Maturity",
  "fd-maturity": "Maturity",
  interest: "Interest",
  coupon: "Coupon",
  "bond-maturity": "Maturity",
  commitment: "Commitment",
  emi: "EMI",
  "emi-end": "Loan ends",
};

function useEvents(from: string, to: string) {
  const { instruments, portfolio, liabilities } = useData();
  return useMemo(() => calendarEvents({ instruments, holdings: portfolio.holdings, liabilities, from, to }), [instruments, portfolio, liabilities, from, to]);
}

function EventRow({ e, showDate = true }: { e: CalEvent; showDate?: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-sm first:border-t-0 sm:px-5">
      {showDate && <span className="w-16 shrink-0 text-xs text-muted num">{formatDate(e.date, { year: false })}</span>}
      <span className="min-w-0 flex-1 truncate">{e.title}</span>
      <Badge tone={e.kind.includes("maturity") || e.kind === "emi-end" ? "accent" : "neutral"}>{KIND_TONE[e.kind]}</Badge>
      {e.amount !== null && (
        <span className={cx("money num w-24 shrink-0 text-right", e.direction === "in" && "text-gain")}>
          {e.direction === "in" ? "+" : "−"}
          {formatINR(e.amount)}
          {e.estimated ? "*" : ""}
        </span>
      )}
    </li>
  );
}

function Agenda() {
  const { asOf } = useData();
  const [days, setDays] = useState(90);
  const events = useEvents(asOf, addDays(asOf, days));
  const byMonth = new Map<string, CalEvent[]>();
  for (const e of events) byMonth.set(monthKey(e.date), [...(byMonth.get(monthKey(e.date)) ?? []), e]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-auto" aria-label="Range">
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
          <option value="180">Next 6 months</option>
          <option value="365">Next 12 months</option>
        </Select>
        <span className="text-xs text-faint">* estimated amounts</span>
      </div>
      {events.length === 0 && <p className="text-sm text-muted">Nothing scheduled. SIPs, RDs, FDs, bonds, commitments and EMIs show up here automatically.</p>}
      {[...byMonth.entries()].map(([m, evs]) => {
        const out = evs.filter((e) => e.direction === "out").reduce((s, e) => s + (e.amount ?? 0), 0);
        const inn = evs.filter((e) => e.direction === "in").reduce((s, e) => s + (e.amount ?? 0), 0);
        return (
          <Card
            key={m}
            pad={false}
            title={formatMonth(m)}
            action={
              <span className="text-xs text-muted num">
                out <Money p={out} compact /> · in <Money p={inn} compact />
              </span>
            }
          >
            <ul className="pt-2">
              {evs.map((e, i) => (
                <EventRow key={i} e={e} />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function MonthGrid() {
  const { asOf } = useData();
  const [month, setMonth] = useState(monthKey(asOf));
  const [day, setDay] = useState<string | null>(null);
  const events = useEvents(monthStart(month), monthEnd(month));
  const first = new Date(`${monthStart(month)}T00:00:00Z`).getUTCDay(); // 0 = Sun
  const offset = (first + 6) % 7; // Monday-first
  const last = Number(monthEnd(month).slice(8));
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const shown = day ? events.filter((e) => e.date === day) : events;
  return (
    <Card
      title={formatMonth(month)}
      action={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => (setMonth(addMonthsToKey(month, -1)), setDay(null))} aria-label="Previous month">
            <IconChevron size={16} className="rotate-180" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setMonth(monthKey(asOf)), setDay(null))}>
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setMonth(addMonthsToKey(month, 1)), setDay(null))} aria-label="Next month">
            <IconChevron size={16} />
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-faint">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const evs = events.filter((e) => e.date === c);
          const isToday = c === todayISO();
          return (
            <button
              key={c}
              onClick={() => setDay(day === c ? null : c)}
              className={cx(
                "flex aspect-square flex-col items-center justify-start rounded-lg border p-1 text-xs sm:aspect-[4/3]",
                day === c ? "border-accent bg-accent-soft" : "border-transparent hover:bg-sunken",
                isToday && "font-bold text-accent",
              )}
              aria-label={`${formatDate(c)}: ${evs.length} events`}
            >
              <span className="num">{Number(c.slice(8))}</span>
              <span className="mt-auto flex flex-wrap justify-center gap-0.5">
                {evs.slice(0, 4).map((e, j) => (
                  <span key={j} className={cx("h-1.5 w-1.5 rounded-full", e.direction === "in" ? "bg-gain" : e.direction === "out" ? "bg-accent" : "bg-faint")} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> money out</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-gain" /> money in</span>
      </div>
      <ul className="-mx-4 mt-3 border-t border-line sm:-mx-5">
        {shown.length === 0 ? <li className="px-5 py-3 text-sm text-muted">Nothing on {day ? formatDate(day) : "this month"}.</li> : shown.map((e, i) => <EventRow key={i} e={e} />)}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Liabilities() {
  const { liabilities, asOf } = useData();
  const [edit, setEdit] = useState<Liability | null>(null);
  return (
    <Card
      title="Loans & EMIs"
      className="mt-4"
      action={
        <Button size="sm" onClick={() => setEdit({ id: "", name: "", emi: 0, emiDay: 5, endDate: addDays(asOf, 365) })}>
          <IconPlus size={14} /> Add
        </Button>
      }
    >
      {liabilities.length === 0 ? (
        <p className="text-sm text-muted">Add an EMI to see its payments and the date it ends on the calendar. Loans aren't subtracted from net worth.</p>
      ) : (
        <ul className="divide-y divide-line">
          {liabilities.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
              <button className="min-w-0 flex-1 truncate text-left font-medium hover:text-accent" onClick={() => setEdit(l)}>
                {l.name} {l.sample && <Badge tone="warn">sample</Badge>}
              </button>
              <Money p={l.emi} />
              <span className="text-xs text-muted">ends {formatDate(l.endDate)}</span>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <Sheet
          open
          onClose={() => setEdit(null)}
          title={edit.id ? "Edit EMI" : "Add EMI"}
          footer={
            <>
              {edit.id && (
                <Button variant="danger" className="mr-auto" onClick={async () => (await db.liabilities.delete(edit.id), setEdit(null))}>
                  <IconTrash size={14} /> Delete
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!edit.name.trim() || edit.emi <= 0 || !isValidISO(edit.endDate)}
                onClick={async () => {
                  await db.liabilities.put({ ...edit, id: edit.id || newId("l_") });
                  setEdit(null);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loan" className="sm:col-span-2">{(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Car loan" />}</Field>
            <Field label="EMI">{(id) => <MoneyInput id={id} value={edit.emi} onChange={(p) => setEdit({ ...edit, emi: p ?? 0 })} />}</Field>
            <Field label="EMI day">{(id) => <NumberInput id={id} value={edit.emiDay} onChange={(n) => setEdit({ ...edit, emiDay: Math.max(1, Math.min(31, Math.round(n ?? 1))) })} />}</Field>
            <Field label="Last EMI date">{(id) => <Input id={id} type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />}</Field>
          </div>
        </Sheet>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

const CAT_LABEL: Record<PlanCategory, string> = { sip: "SIP", rd: "RD", commitment: "Commitment", buffer: "Buffer", other: "Other" };

function PlanView() {
  const { plans, instruments, settings, txns, asOf } = useData();
  const [month, setMonth] = useState(monthKey(asOf));
  const stored = plans.find((p) => p.month === month);
  const base = stored ?? defaultPlan(instruments, settings, month);
  const [draft, setDraft] = useState<MonthlyPlan | null>(null);
  const plan = draft && draft.month === month ? draft : base;
  const view = planView(plan, txns, instruments);
  const dirty = draft !== null && draft.month === month;

  const history = useMemo(() => {
    const out: { month: string; planned: number; actual: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonthsToKey(monthKey(asOf), -i);
      const p = plans.find((x) => x.month === m) ?? defaultPlan(instruments, settings, m);
      const v = planView(p, txns, instruments);
      out.push({ month: m, planned: v.plannedTotal / 100, actual: v.actualTotal / 100 });
    }
    return out;
  }, [plans, instruments, settings, txns, asOf]);

  const setLine = (id: string, patch: Partial<PlanLine>) => setDraft({ ...plan, lines: plan.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`Plan · ${formatMonth(month)}`}
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => (setMonth(addMonthsToKey(month, -1)), setDraft(null))} aria-label="Previous month">
              <IconChevron size={16} className="rotate-180" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setMonth(addMonthsToKey(month, 1)), setDraft(null))} aria-label="Next month">
              <IconChevron size={16} />
            </Button>
          </div>
        }
        pad={false}
      >
        <div className="px-4 pt-1 pb-3 text-xs text-muted sm:px-5">
          Budget <Money p={settings.monthlyBudget} /> · planned <Money p={view.plannedTotal} /> · invested so far <Money p={view.actualTotal} className="font-medium text-ink" />
          {!stored && !dirty && " · default plan from your SIPs, RDs and commitments"}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium sm:px-5">Line</th>
              <th className="px-3 py-2 text-right font-medium">Planned</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-4 py-2 font-medium sm:px-5"><span className="sr-only">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const done = r.actual >= r.planned && r.planned > 0;
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2 sm:px-5">
                    <div className="flex items-center gap-2">
                      <Badge>{CAT_LABEL[r.category]}</Badge>
                      <input className="min-w-0 flex-1 bg-transparent focus:outline-none" value={r.label} onChange={(e) => setLine(r.id, { label: e.target.value })} aria-label="Line label" />
                    </div>
                  </td>
                  <td className="w-32 px-3 py-1.5 text-right">
                    <MoneyInput value={r.planned} onChange={(p) => setLine(r.id, { planned: p ?? 0 })} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Money p={r.actual} />
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap sm:px-5">
                    {done ? <span className="text-gain">✓ done</span> : r.actual > 0 ? <span className="text-warn">{formatCompact(r.planned - r.actual)} left</span> : <span className="text-faint">pending</span>}
                    <button className="ml-2 text-faint hover:text-loss" aria-label="Remove line" onClick={() => setDraft({ ...plan, lines: plan.lines.filter((l) => l.id !== r.id) })}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.unplanned.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted sm:px-5">
            Unplanned this month (counted in buffer): {view.unplanned.map((u) => `${u.label} ${formatINR(u.actual)}`).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5">
          <Button size="sm" onClick={() => setDraft({ ...plan, lines: [...plan.lines, { id: newId("p_"), category: "other", label: "New line", planned: 0 }] })}>
            <IconPlus size={14} /> Line
          </Button>
          {(stored || dirty) && (
            <Button size="sm" variant="ghost" onClick={async () => (await db.plans.delete(month), setDraft(null))}>
              Reset to default
            </Button>
          )}
          <Button size="sm" variant="primary" className="ml-auto" disabled={!dirty} onClick={async () => (await db.plans.put(plan), setDraft(null))}>
            Save plan
          </Button>
        </div>
      </Card>

      <Card title="Planned vs invested · last 6 months">
        <div className="money h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={history} barGap={2}>
              <XAxis dataKey="month" tickFormatter={(m: string) => formatMonth(m).slice(0, 3)} tick={{ fill: "var(--faint)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: "var(--sunken)" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }}
                labelFormatter={(m) => formatMonth(String(m))}
                formatter={(v, n) => [formatINR(Math.round(Number(v) * 100)), n === "planned" ? "Planned" : "Invested"]}
              />
              <Bar dataKey="planned" fill="var(--line)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-line" /> Planned</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Invested</span>
        </div>
      </Card>
    </div>
  );
}
