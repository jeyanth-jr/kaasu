import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { addGoalFund, deleteGoal, deleteGoalFund, saveGoal, setGoalArchived } from "../db/goals";
import { addMonths, formatDate, todayISO } from "../domain/dates";
import { GOAL_TEMPLATES, STATUS_LABEL, crossedMilestones, goalProgress, monthsBetween, requiredMonthly, termFor, type Goal, type GoalTemplate, type GoalTerm } from "../domain/goals";
import { formatINR } from "../domain/money";
import type { Win } from "../domain/savings";
import { celebrate } from "./celebrate";
import { Badge, Button, Callout, Field, Input, Money, Sheet, Tabs, cx } from "./components";
import { useData } from "./data";
import { IconCheck, IconPlus, IconTrash } from "./icons";
import { GOAL_ICONS, ProgressRing, STATUS_TONE, goalIcon } from "./goalStyle";
import { MoneyInput, NumberInput } from "./inputs";
import { useGoals } from "./useGoals";

// ---------------------------------------------------------------------------
// Create / edit

const HORIZONS = [
  { label: "6 months", months: 6 },
  { label: "1 year", months: 12 },
  { label: "3 years", months: 36 },
  { label: "5 years", months: 60 },
  { label: "10 years", months: 120 },
];

export function GoalSheet({ open, onClose, goal, onSaved }: { open: boolean; onClose: () => void; goal?: Goal | null; onSaved?: (g: Goal) => void }) {
  const { portfolio } = useData();
  const today = todayISO();
  const [template, setTemplate] = useState<GoalTemplate | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("target");
  const [target, setTarget] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [term, setTerm] = useState<GoalTerm>("short");
  const [termTouched, setTermTouched] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [linked, setLinked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTemplate(null);
    setName(goal?.name ?? "");
    setIcon(goal?.icon ?? "target");
    setTarget(goal?.target ?? null);
    setDate(goal?.targetDate ?? "");
    setTerm(goal?.term ?? "short");
    setTermTouched(!!goal);
    setRate(goal?.ratePct ?? null);
    setSaved(null);
    setLinked(goal?.linkedInstrumentIds ?? []);
    setNote(goal?.note ?? "");
    setError(null);
  }, [open, goal]);

  const pick = (t: GoalTemplate) => {
    setTemplate(t);
    setName(t.key === "custom" ? "" : t.name);
    setIcon(t.icon);
    setTerm(t.term);
    setDate(addMonths(today, t.months));
    setTermTouched(false);
  };
  const setDateAndTerm = (d: string) => {
    setDate(d);
    if (!termTouched && d) setTerm(termFor(d, today));
  };

  const months = date && date > today ? monthsBetween(today, date) : null;
  const need = target && months ? requiredMonthly({ target, saved: saved ?? 0, months, ratePct: rate ?? 0 }) : null;
  const holdings = useMemo(() => portfolio.holdings.filter((h) => !h.instrument.archived && h.value > 0 && h.instrument.kind !== "commitment"), [portfolio]);

  async function save() {
    if (!name.trim()) return setError("What's the goal called?");
    if (!target || target <= 0) return setError("Set a target amount.");
    if (date && !goal && date <= today) return setError("Pick a target date in the future, or leave it blank.");
    const g = await saveGoal({ name, icon, term, target, targetDate: date || undefined, ratePct: rate ?? undefined, linkedInstrumentIds: linked, note, alreadySaved: saved ?? 0, startDate: today }, goal ?? undefined);
    onSaved?.(g);
    onClose();
  }

  const chooseTemplate = !goal && !template;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={goal ? "Edit goal" : template ? template.name : "New goal"}
      footer={
        chooseTemplate ? undefined : (
          <>
            {!goal && (
              <Button variant="ghost" className="mr-auto" onClick={() => setTemplate(null)}>
                Back
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              {goal ? "Save" : "Create goal"}
            </Button>
          </>
        )
      }
    >
      {chooseTemplate ? (
        <div className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3">
          {GOAL_TEMPLATES.map((t, i) => {
            const Icon = goalIcon(t.icon);
            return (
              <motion.button
                key={t.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => pick(t)}
                className="glass flex flex-col items-start gap-3 rounded-3xl p-3.5 text-left"
              >
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent-soft text-accent">
                  <Icon size={20} />
                </span>
                <span>
                  <span className="block text-sm font-bold">{t.name}</span>
                  <span className="block text-[11px] leading-snug text-muted">{t.hint}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          {error && <Callout tone="warn">{error}</Callout>}
          <Field label="Goal name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Trip to Japan" autoFocus />}</Field>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted">Icon</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(GOAL_ICONS).map(([k, Icon]) => (
                <button key={k} type="button" aria-label={k} aria-pressed={icon === k} onClick={() => setIcon(k)} className={cx("grid h-10 w-10 place-items-center rounded-2xl border transition active:scale-95", icon === k ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-sunken/40 text-muted hover:text-ink")}>
                  <Icon size={18} />
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target amount">{(id) => <MoneyInput id={id} value={target} onChange={setTarget} placeholder="2,00,000" />}</Field>
            <Field label="Target date">{(id) => <Input id={id} type="date" value={date} min={goal ? undefined : addMonths(today, 1)} onChange={(e) => setDateAndTerm(e.target.value)} />}</Field>
          </div>
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {HORIZONS.map((h) => (
              <button key={h.label} type="button" onClick={() => setDateAndTerm(addMonths(today, h.months))} className="rounded-full bg-sunken px-3 py-1 text-xs font-semibold text-muted transition hover:text-ink active:scale-95">
                {h.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Horizon</span>
            <Tabs
              value={term}
              onChange={(t) => {
                setTerm(t);
                setTermTouched(true);
              }}
              options={[
                { value: "short", label: "Short term" },
                { value: "long", label: "Long term" },
              ]}
            />
          </div>
          {!goal && (
            <Field label="Already saved for this" hint="Money you've already set aside. You can add more any time.">
              {(id) => <MoneyInput id={id} value={saved} onChange={setSaved} placeholder="0" />}
            </Field>
          )}
          {need !== null && target && (
            <Callout tone="accent" title={need === 0 ? "Already covered" : `Put aside ${formatINR(need)} a month`}>
              {months} month{months === 1 ? "" : "s"} to go{rate ? `, assuming ${rate}% a year on what you save` : ""}.
            </Callout>
          )}
          <Field label="Expected yearly return" hint="Optional. 0 if it sits in a savings account, or what a debt fund or RD might earn.">
            {(id) => <NumberInput id={id} value={rate} onChange={setRate} placeholder="0" />}
          </Field>
          {holdings.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-muted">Count these holdings toward it</div>
              <div className="flex flex-wrap gap-1.5">
                {holdings.map((h) => {
                  const on = linked.includes(h.instrument.id);
                  return (
                    <button
                      key={h.instrument.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setLinked(on ? linked.filter((x) => x !== h.instrument.id) : [...linked, h.instrument.id])}
                      className={cx("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95", on ? "border-accent/60 bg-accent-soft text-accent" : "border-line bg-sunken/40 text-muted hover:text-ink")}
                    >
                      {on && <IconCheck size={12} />}
                      {h.instrument.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-faint">A linked holding counts at its current value, so the goal moves with the market.</p>
            </div>
          )}
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />}</Field>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Add or take out money

export function FundSheet({ open, onClose, goal, mode }: { open: boolean; onClose: () => void; goal: Goal | null; mode: "add" | "take" }) {
  const { settings, goalFunds, portfolio, asOf } = useData();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setAmount(null);
      setDate(todayISO());
      setNote("");
      setError(null);
    }
  }, [open, goal?.id]);

  async function save() {
    if (!goal) return;
    if (!amount || amount <= 0) return setError("How much?");
    if (date > todayISO()) return setError("That's in the future: add it when it happens.");
    const linkedValue = (goal.linkedInstrumentIds ?? []).reduce((s, id) => s + (portfolio.holdings.find((h) => h.instrument.id === id)?.value ?? 0), 0);
    const before = goalProgress({ goal, funds: goalFunds, linkedValue, today: asOf });
    await addGoalFund(goal.id, mode === "add" ? amount : -amount, date, note);
    const after = goalProgress({ goal, funds: [...goalFunds, { id: "", goalId: goal.id, date, amount: mode === "add" ? amount : -amount, createdAt: "" }], linkedValue, today: asOf });
    if (mode === "add" && settings.celebrations !== false) {
      const hit = crossedMilestones(before.fraction, after.fraction).pop();
      if (hit) celebrate(goalWin(goal, hit, after.saved));
    }
    onClose();
  }

  return (
    <Sheet
      open={open && !!goal}
      onClose={onClose}
      title={mode === "add" ? `Add to ${goal?.name ?? "goal"}` : `Take out of ${goal?.name ?? "goal"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {mode === "add" ? "Add money" : "Take out"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {error && <Callout tone="warn">{error}</Callout>}
        <Field label="Amount">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />}</Field>
        </div>
        <p className="text-xs text-faint">This records money you've set aside for the goal. It doesn't move money between your bank accounts.</p>
      </div>
    </Sheet>
  );
}

function goalWin(goal: Goal, pct: number, saved: number): Win {
  const detail = `${formatINR(saved)} of ${formatINR(goal.target)}`;
  if (pct >= 100) return { key: `goal-${goal.id}-100`, kind: "goal", tier: "big", title: `${goal.name}: fully funded!`, detail };
  if (pct >= 75) return { key: `goal-${goal.id}-75`, kind: "goal", tier: "medium", title: `${goal.name}: almost there`, detail };
  return { key: `goal-${goal.id}-${pct}`, kind: "goal", tier: "small", title: pct === 50 ? `${goal.name}: halfway` : `${goal.name}: ${pct}% saved`, detail };
}

// ---------------------------------------------------------------------------
// One goal in detail

export function GoalDetailSheet({ goalId, onClose, onEdit }: { goalId: string | null; onClose: () => void; onEdit: (g: Goal) => void }) {
  const { goalFunds, asOf } = useData();
  const { active, reached, archived } = useGoals();
  const [fund, setFund] = useState<"add" | "take" | null>(null);
  const view = [...active, ...reached, ...archived].find((v) => v.goal.id === goalId);
  const goal = view?.goal ?? null;
  const p = view?.progress;
  const history = useMemo(() => goalFunds.filter((f) => f.goalId === goalId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)), [goalFunds, goalId]);
  const Icon = goal ? goalIcon(goal.icon) : goalIcon("target");
  const ahead = p?.expectedByNow != null ? p.saved - p.expectedByNow : null;

  return (
    <>
      <Sheet open={!!goal && fund === null} onClose={onClose} title={goal?.name ?? ""}>
        {goal && p && (
          <div className="flex flex-col gap-4 pb-3">
            <div className="bg-hero flex items-center gap-4 rounded-3xl p-5">
              <ProgressRing fraction={p.fraction} size={92} stroke={9} color="#f0d58a">
                <span className="display text-xl font-extrabold">{Math.min(999, Math.round(p.fraction * 100))}%</span>
              </ProgressRing>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/70">
                  <Icon size={14} /> {goal.term === "short" ? "Short term" : "Long term"}
                </div>
                <Money p={p.saved} className="display mt-0.5 block text-3xl font-extrabold" />
                <div className="text-sm text-white/75">
                  of <Money p={goal.target} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              {goal.targetDate && <Badge>{p.monthsLeft ? `${p.monthsLeft} mo to ${formatDate(goal.targetDate, { year: true })}` : formatDate(goal.targetDate, { year: true })}</Badge>}
              {ahead !== null && !p.done && Math.abs(ahead) > 0 && (
                <span className="text-xs text-muted">{ahead >= 0 ? `${formatINR(ahead)} ahead of a steady plan` : `${formatINR(-ahead)} behind a steady plan`}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Mini label="Still to go" value={<Money p={p.remaining} />} />
              <Mini label="Needed a month" value={p.done ? "Done" : p.requiredMonthly !== null ? <Money p={p.requiredMonthly} /> : "Set a date"} />
              <Mini label="Your recent pace" value={p.recentMonthly > 0 ? <><Money p={p.recentMonthly} />/mo</> : "Nothing lately"} />
              <Mini label="At that pace" value={p.done ? "Reached" : p.projectedDate ? formatDate(p.projectedDate, { year: true }) : "Add money to see"} />
            </div>
            {p.linked > 0 && (
              <Callout tone="accent" title={`${formatINR(p.linked)} from linked holdings`}>
                Counted at today's value, so it moves with the market.
              </Callout>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setFund("add")}>
                <IconPlus size={15} /> Add money
              </Button>
              <Button onClick={() => setFund("take")} disabled={p.contributed <= 0}>
                Take out
              </Button>
              <Button variant="ghost" onClick={() => onEdit(goal)}>
                Edit
              </Button>
            </div>

            <div>
              <div className="mb-1 text-xs font-bold tracking-wider text-faint uppercase">History</div>
              {history.length === 0 ? (
                <p className="py-3 text-sm text-muted">Nothing added yet.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {history.map((f) => (
                    <li key={f.id} className="group flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{f.amount >= 0 ? "Added" : "Taken out"}</span>
                        <span className="block text-xs text-muted">
                          {formatDate(f.date, { year: true })}
                          {f.note ? ` · ${f.note}` : ""}
                        </span>
                      </span>
                      <Money p={f.amount} sign className={cx("text-sm font-bold", f.amount >= 0 && "text-gain")} />
                      <button
                        onClick={async () => confirm("Remove this entry?") && (await deleteGoalFund(f.id))}
                        className="grid h-8 w-8 place-items-center rounded-full text-faint opacity-0 transition hover:bg-loss-soft hover:text-loss focus:opacity-100 group-hover:opacity-100"
                        aria-label="Remove entry"
                      >
                        <IconTrash size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await setGoalArchived(goal, !goal.archived, asOf);
                  onClose();
                }}
              >
                {goal.archived ? "Bring back" : p.done ? "Move to done" : "Archive"}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (!confirm(`Delete ${goal.name} and its history?`)) return;
                  await deleteGoal(goal.id);
                  onClose();
                }}
              >
                Delete goal
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <FundSheet open={fund !== null} mode={fund ?? "add"} goal={goal} onClose={() => setFund(null)} />
    </>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl px-3.5 py-3">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-0.5 text-base font-bold num">{value}</div>
    </div>
  );
}
