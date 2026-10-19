import { motion } from "motion/react";
import { useState } from "react";
import { useAdd } from "../App";
import { saveSettings } from "../db/db";
import { formatDate } from "../domain/dates";
import { formatINR } from "../domain/money";
import { GOAL_STEPS, describeKey, nextGoalStep } from "../domain/savings";
import { Badge, Button, Callout, Card, Field, Sheet, cx } from "./components";
import { SparkleBurst, celebrate, haptic, winIcon } from "./celebrate";
import { useData } from "./data";
import { IconCheck, IconFlame, IconPlus, IconTrophy } from "./icons";
import { MoneyInput } from "./inputs";
import { useSavingsView } from "./useSavings";

const SIZE = 132;
const R = 52;
const C = 2 * Math.PI * R;

function headline(pct: number): string {
  if (pct >= 150) return "Overachiever";
  if (pct >= 100) return "Goal smashed";
  if (pct >= 75) return "So close";
  if (pct >= 50) return "Past halfway";
  if (pct >= 25) return "Building momentum";
  if (pct > 0) return "Good start";
  return "Fresh month, fresh start";
}

function Ring({ pct, onTap }: { pct: number; onTap: () => void }) {
  const main = Math.min(pct, 100) / 100;
  const over = Math.max(0, Math.min(pct, 200) - 100) / 100;
  const done = pct >= 100;
  return (
    <motion.button
      onClick={onTap}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94, rotate: -3 }}
      className="relative shrink-0 rounded-full outline-offset-4"
      style={{ width: SIZE, height: SIZE }}
      aria-label={done ? "Goal reached. Tap to celebrate again" : `Savings goal ${Math.round(pct)}% complete`}
    >
      {done && <SparkleBurst />}
      <svg width={SIZE} height={SIZE} viewBox="0 0 120 120" className="-rotate-90">
        <defs>
          <linearGradient id="goalGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--sunken)" strokeWidth="11" />
        <motion.circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="url(#goalGrad)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - main) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
        {over > 0 && (
          <motion.circle
            cx="60"
            cy="60"
            r={R - 13}
            fill="none"
            stroke="var(--lime)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * (R - 13)}
            initial={{ strokeDashoffset: 2 * Math.PI * (R - 13) }}
            animate={{ strokeDashoffset: 2 * Math.PI * (R - 13) * (1 - Math.min(over, 1)) }}
            transition={{ duration: 1, delay: 0.3 }}
          />
        )}
        {[25, 50, 75].map((step) => {
          const a = (step / 100) * 2 * Math.PI;
          const reached = pct >= step;
          return <circle key={step} cx={60 + R * Math.cos(a)} cy={60 + R * Math.sin(a)} r={reached ? 3.6 : 2.6} fill={reached ? "var(--lime)" : "var(--faint)"} stroke="var(--surface)" strokeWidth="1.5" />;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="display text-3xl leading-none font-extrabold num">{Math.round(pct)}%</div>
          <div className="mt-1 text-[11px] font-semibold text-muted">of goal</div>
        </div>
      </div>
    </motion.button>
  );
}

export function SavingsGoalCard() {
  const { openAdd } = useAdd();
  const { settings } = useData();
  const v = useSavingsView();
  const [editing, setEditing] = useState(false);
  const [wins, setWins] = useState(false);
  const pct = v.goal > 0 ? (v.saved / v.goal) * 100 : 0;
  const next = nextGoalStep(v.saved, v.goal);
  const sourceNote = v.goalSource === "set" ? "your goal" : v.goalSource === "plans" ? "from your SIP, RD and chit plans" : v.goalSource === "salary" ? "20% of your salary" : "a starter goal";

  function tapRing() {
    if (pct >= 100) {
      const w = describeKey(`goal:${v.month}:${pct >= 150 ? 150 : 100}`);
      if (w) celebrate({ ...w, detail: `${formatINR(v.saved)} saved this month` });
    } else haptic("small");
  }

  return (
    <>
      <Card title="Savings goal" icon={<IconTrophy size={15} />} action={<Badge tone={pct >= 100 ? "lime" : "neutral"}>{pct >= 100 ? "Reached" : "This month"}</Badge>}>
        <div className="flex flex-wrap items-center gap-5">
          <Ring pct={pct} onTap={tapRing} />
          <div className="min-w-0 flex-1 basis-48">
            <div className="display text-2xl leading-tight font-extrabold">{headline(pct)}</div>
            <div className="mt-1 text-sm text-muted">
              <b className="money text-ink num">{formatINR(v.saved)}</b> of <span className="money num">{formatINR(v.goal)}</span> saved · <span className="text-xs">{sourceNote}</span>
            </div>
            {next ? (
              <div className="mt-2 text-xs text-muted">
                Next milestone: <b className="text-ink">{next.pct}%</b> at <span className="money num">{formatINR(next.amount)}</span> · <span className="money num">{formatINR(Math.max(0, next.amount - v.saved))}</span> to go
              </div>
            ) : (
              <div className="mt-2 text-xs font-semibold text-gain">Every milestone cleared this month.</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {v.streak >= 1 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-lime px-3 py-1 text-xs font-bold text-lime-ink">
                  <IconFlame size={13} /> {v.streak}-month streak
                </span>
              )}
              <Button size="sm" variant="primary" onClick={() => openAdd()}>
                <IconPlus size={14} /> Add savings
              </Button>
              <Button size="sm" onClick={() => setEditing(true)}>
                Goal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWins(true)}>
                <IconTrophy size={14} /> Wins · {settings.wins.length}
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-1 border-t border-line pt-3">
          {GOAL_STEPS.map((s) => {
            const hit = pct >= s;
            return (
              <div key={s} className="flex flex-1 flex-col items-center gap-1">
                <span className={cx("grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold transition-colors", hit ? "bg-lime text-lime-ink" : "bg-sunken text-faint")}>
                  {hit ? <IconCheck size={13} strokeWidth={3} /> : ""}
                </span>
                <span className={cx("text-[11px] font-semibold num", hit ? "text-ink" : "text-faint")}>{s}%</span>
              </div>
            );
          })}
        </div>
      </Card>
      {editing && <GoalSheet onClose={() => setEditing(false)} planned={v.planned} current={settings.savingsGoal} />}
      {wins && <WinsSheet onClose={() => setWins(false)} />}
    </>
  );
}

function GoalSheet({ onClose, planned, current }: { onClose: () => void; planned: number; current?: number }) {
  const { settings } = useData();
  const [goal, setGoal] = useState<number | null>(current ?? null);
  const salary = settings.salary?.amount;
  const chips: { label: string; value: number }[] = [];
  if (planned > 0) chips.push({ label: "My plans", value: planned });
  if (salary) for (const p of [10, 20, 30]) chips.push({ label: `${p}% of salary`, value: Math.round((salary * p) / 100 / 500_00) * 500_00 });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Monthly savings goal"
      footer={
        <>
          {current && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                await saveSettings({ savingsGoal: undefined });
                onClose();
              }}
            >
              Back to automatic
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!goal}
            onClick={async () => {
              await saveSettings({ savingsGoal: goal ?? undefined });
              onClose();
            }}
          >
            Save goal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout tone="neutral">What you put into investments, SIPs, RDs, deposits and chits each month counts toward this. Cash moves between accounts don't.</Callout>
        <Field label="Save this much every month">{(id) => <MoneyInput id={id} value={goal} onChange={setGoal} />}</Field>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button key={c.label} onClick={() => setGoal(c.value)} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-accent hover:bg-accent-soft/50">
                {c.label} · <span className="money num">{formatINR(c.value)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function WinsSheet({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const wins = [...settings.wins].reverse().map((w) => ({ ...w, d: describeKey(w.key) })).filter((w) => w.d);
  return (
    <Sheet open onClose={onClose} title="Your wins">
      {wins.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No wins yet. Add a SIP instalment or an investment and your first milestone lands.</p>
      ) : (
        <ul className="flex flex-col gap-2 pb-2">
          {wins.map((w) => {
            const Icon = winIcon(w.d!.kind);
            return (
              <li key={w.key}>
                <button onClick={() => celebrate(w.d!)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-left transition hover:border-accent/40 hover:bg-accent-soft/30" title="Celebrate again">
                  <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl", w.d!.tier === "big" ? "bg-lime text-lime-ink" : "bg-accent-soft text-accent")}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{w.d!.title}</span>
                    <span className="block text-xs text-muted">{w.d!.detail}</span>
                  </span>
                  <span className="shrink-0 text-xs text-faint">{formatDate(w.at.slice(0, 10), { year: false })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="pb-1 text-xs text-faint">Tap a win to celebrate it again. Wins are never repeated on their own.</p>
    </Sheet>
  );
}

