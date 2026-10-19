import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDate } from "../domain/dates";
import { STATUS_LABEL } from "../domain/goals";
import { formatINR } from "../domain/money";
import { AnimatedMoney, Badge, Button, EmptyState, Money, PageHeader, Tabs } from "../ui/components";
import { CoinMark } from "../ui/Coin";
import { GoalDetailSheet, GoalSheet } from "../ui/GoalSheets";
import { ProgressRing, STATUS_TONE, goalIcon } from "../ui/goalStyle";
import { IconPlus } from "../ui/icons";
import { useGoals, type GoalView } from "../ui/useGoals";
import type { Goal } from "../domain/goals";

type Filter = "all" | "short" | "long";

export function GoalsPage() {
  const { active, reached, archived } = useGoals();
  const [filter, setFilter] = useState<Filter>("all");
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Goal | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (params.size === 0) return;
    if (params.get("new") === "1") setCreating(true);
    if (params.get("open")) setOpenId(params.get("open"));
    setParams({}, { replace: true });
  }, [params]);
  const closeCreate = () => setCreating(false);
  const shown = (list: GoalView[]) => list.filter((v) => filter === "all" || v.goal.term === filter);
  const live = shown(active);
  const totalSaved = active.reduce((s, v) => s + Math.min(v.progress.saved, v.goal.target), 0);
  const totalTarget = active.reduce((s, v) => s + v.goal.target, 0);
  const perMonth = active.reduce((s, v) => s + (v.progress.requiredMonthly ?? 0), 0);
  const empty = active.length + reached.length + archived.length === 0;

  return (
    <>
      <PageHeader
        title="Goals"
        sub="Things you're saving for, short term and long term, separate from your investments."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <IconPlus size={16} /> New goal
          </Button>
        }
      />

      {empty ? (
        <EmptyState
          icon={<CoinMark size={52} />}
          title="What are you saving for?"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus size={16} /> Set your first goal
            </Button>
          }
        >
          A trip, a phone, an emergency fund, a home. Set a target and a date, and Kaasu works out what to put aside each month and tells you if you're on track.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {active.length > 0 && (
            <div className="bg-hero rounded-[2rem] p-5 sm:p-7">
              <div className="text-sm font-semibold text-white/70">Saved toward {active.length} goal{active.length === 1 ? "" : "s"}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <AnimatedMoney p={totalSaved} className="display text-5xl font-extrabold sm:text-6xl" />
                <span className="text-sm text-white/75">
                  of <Money p={totalTarget} compact />
                </span>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15">
                <motion.div initial={{ width: 0 }} animate={{ width: `${totalTarget ? (totalSaved / totalTarget) * 100 : 0}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className="h-full rounded-full bg-gradient-to-r from-[#f0d58a] to-[#e3b94d]" />
              </div>
              {perMonth > 0 && (
                <div className="mt-3 text-sm text-white/80">
                  About <b className="text-white">{formatINR(perMonth)}</b> a month keeps every goal on schedule.
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All${active.length ? ` · ${active.length}` : ""}` },
                { value: "short", label: `Short term · ${active.filter((v) => v.goal.term === "short").length}` },
                { value: "long", label: `Long term · ${active.filter((v) => v.goal.term === "long").length}` },
              ]}
            />
            <span className="text-xs text-faint">Short term is up to 3 years out.</span>
          </div>

          {live.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No {filter === "all" ? "active" : filter === "short" ? "short term" : "long term"} goals. {reached.length > 0 && "Your finished goals are below."}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {live.map((v, i) => (
                <GoalCard key={v.goal.id} view={v} index={i} onOpen={() => setOpenId(v.goal.id)} />
              ))}
            </div>
          )}

          {shown(reached).length > 0 && (
            <Section title={`Reached · ${shown(reached).length}`} open>
              <div className="grid gap-4 sm:grid-cols-2">
                {shown(reached).map((v, i) => (
                  <GoalCard key={v.goal.id} view={v} index={i} onOpen={() => setOpenId(v.goal.id)} />
                ))}
              </div>
            </Section>
          )}
          {shown(archived).length > 0 && (
            <Section title={`Archived · ${shown(archived).length}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                {shown(archived).map((v, i) => (
                  <GoalCard key={v.goal.id} view={v} index={i} onOpen={() => setOpenId(v.goal.id)} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      <GoalSheet open={creating || edit !== null} goal={edit} onClose={() => (edit ? setEdit(null) : closeCreate())} onSaved={(g) => !edit && setOpenId(g.id)} />
      <GoalDetailSheet
        goalId={openId}
        onClose={() => setOpenId(null)}
        onEdit={(g) => {
          setOpenId(null);
          setEdit(g);
        }}
      />
    </>
  );
}

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group">
      <summary className="mb-3 cursor-pointer text-xs font-bold tracking-wider text-faint uppercase">{title}</summary>
      {children}
    </details>
  );
}

export function GoalCard({ view, index = 0, onOpen, compact }: { view: GoalView; index?: number; onOpen: () => void; compact?: boolean }) {
  const { goal, progress: p } = view;
  const Icon = goalIcon(goal.icon);
  const color = p.done ? "var(--gain)" : goal.term === "short" ? "var(--c-debt)" : "var(--c-equity)";
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      className="glass flex cursor-pointer items-center gap-4 rounded-3xl p-4 text-left sm:p-5"
    >
      <ProgressRing fraction={p.fraction} size={compact ? 60 : 76} color={color}>
        <Icon size={compact ? 20 : 24} style={{ color }} />
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[15px] font-bold">{goal.name}</h3>
          {!compact && <Badge className="shrink-0">{goal.term === "short" ? "Short" : "Long"}</Badge>}
        </div>
        <div className="mt-0.5 text-sm text-muted num">
          <Money p={p.saved} className="font-semibold text-ink" /> of <Money p={goal.target} compact />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
          {!p.done && p.requiredMonthly !== null && p.monthsLeft ? (
            <span className="text-muted">
              <Money p={p.requiredMonthly} compact />/mo · {p.monthsLeft} mo left
            </span>
          ) : goal.targetDate ? (
            <span className="text-muted">by {formatDate(goal.targetDate, { year: true })}</span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
