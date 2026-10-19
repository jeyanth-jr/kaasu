import { motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdd } from "../App";
import { loadSampleData } from "../db/sample";
import { saveSettings } from "../db/db";
import { formatINR } from "../domain/money";
import { useDemo } from "../sync/demo";
import { syncConfigured } from "../sync/config";
import { useSyncState } from "../sync/state";
import { fireConfetti, haptic } from "./celebrate";
import { Button, Field, Input, cx } from "./components";
import { useData } from "./data";
import { IconBanknote, IconCalendarClock, IconCheck, IconRepeat, IconSparkles, IconTrendUp, IconUpload, IconWallet } from "./icons";
import { Logo } from "./Logo";
import { MoneyInput, NumberInput } from "./inputs";

const STEPS = 4;

/**
 * First-run welcome. Shows once for an account with no data yet; skipping or finishing
 * marks it done in settings, so it never reappears on other devices either.
 */
export function Onboarding() {
  const { ready, settings, instruments, cash } = useData();
  const sync = useSyncState();
  const demo = useDemo();
  const navigate = useNavigate();
  const { openAdd } = useAdd();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.displayName ?? "");
  const [salary, setSalary] = useState<number | null>(settings.salary?.amount ?? null);
  const [day, setDay] = useState<number | null>(settings.salary?.day ?? 1);
  const [expenses, setExpenses] = useState<number | null>(settings.monthlyExpenses);
  const [goal, setGoal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Wait for the first cloud pull so a returning user on a new device isn't shown a welcome.
  const settled = !syncConfigured || sync.status === "idle";
  const show = ready && settled && !demo && !settings.onboarded && instruments.length === 0 && cash.length === 0;
  if (!show) return null;

  async function finish(then?: "invest" | "import" | "plans" | "sample") {
    setBusy(true);
    await saveSettings({
      displayName: name.trim() || undefined,
      salary: salary && day ? { amount: salary, day: Math.max(1, Math.min(31, day)) } : settings.salary,
      monthlyExpenses: expenses ?? settings.monthlyExpenses,
      savingsGoal: goal ?? undefined,
      onboarded: true,
    });
    fireConfetti("medium");
    haptic("medium");
    if (then === "sample") await loadSampleData();
    if (then === "import") navigate("/settings#import");
    if (then === "plans") navigate("/plans");
    if (then === "invest") setTimeout(() => openAdd(), 250);
  }

  const goalChips = salary ? [10, 20, 30].map((p) => ({ p, value: Math.round((salary * p) / 100 / 500_00) * 500_00 })) : [];

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-paper" role="dialog" aria-modal="true" aria-label="Welcome to Kaasu">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8">
        <div className="flex items-center justify-between py-2">
          <Logo />
          <button className="text-sm font-semibold text-muted hover:text-ink" disabled={busy} onClick={() => void saveSettings({ onboarded: true })}>
            Skip
          </button>
        </div>

        <div className="my-4 flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
              <motion.span className="block h-full rounded-full bg-gradient-to-r from-accent to-accent-2" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ duration: 0.4 }} />
            </span>
          ))}
        </div>

        <div className="flex flex-1 flex-col justify-center py-4">
          {/* Enter-only transition: nothing waits on an exit animation, so steps always advance. */}
          <motion.div key={step} initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22 }} className="flex flex-col gap-5">
              {step === 0 && (
                <>
                  <span className="grid h-14 w-14 place-items-center rounded-3xl bg-hero shadow-card">
                    <IconSparkles size={26} />
                  </span>
                  <div>
                    <h1 className="display text-4xl leading-tight font-extrabold">Welcome to Kaasu</h1>
                    <p className="mt-2 text-muted">Let's set up your month in a minute. You can change everything later.</p>
                  </div>
                  <Field label="What should we call you?">{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" autoComplete="given-name" />}</Field>
                </>
              )}
              {step === 1 && (
                <>
                  <span className="grid h-14 w-14 place-items-center rounded-3xl bg-accent-soft text-accent">
                    <IconCalendarClock size={26} />
                  </span>
                  <div>
                    <h1 className="display text-3xl leading-tight font-extrabold">When does your salary land?</h1>
                    <p className="mt-2 text-muted">On payday Kaasu asks "did it arrive?" and plans every rupee: SIPs, EMIs and what's safe to spend.</p>
                  </div>
                  <Field label="In-hand salary (after tax and PF)">{(id) => <MoneyInput id={id} value={salary} onChange={setSalary} />}</Field>
                  <Field label="Usually credited on day" hint="Weekend paydays move to the Friday before">
                    {(id) => <NumberInput id={id} value={day} onChange={(n) => setDay(n === null ? null : Math.round(n))} />}
                  </Field>
                </>
              )}
              {step === 2 && (
                <>
                  <span className="grid h-14 w-14 place-items-center rounded-3xl bg-accent-soft text-accent">
                    <IconWallet size={26} />
                  </span>
                  <div>
                    <h1 className="display text-3xl leading-tight font-extrabold">Your safety net and your goal</h1>
                    <p className="mt-2 text-muted">Monthly expenses size your emergency fund. The savings goal powers your progress ring and the celebrations.</p>
                  </div>
                  <Field label="Monthly expenses (rent, food, bills…)">{(id) => <MoneyInput id={id} value={expenses} onChange={setExpenses} />}</Field>
                  <Field label="Save this much every month" hint="Skip it and we'll use your SIP, RD and chit plans, or 20% of salary">
                    {(id) => <MoneyInput id={id} value={goal} onChange={setGoal} />}
                  </Field>
                  {goalChips.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {goalChips.map((c) => (
                        <button key={c.p} onClick={() => setGoal(c.value)} className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold transition", goal === c.value ? "border-accent bg-accent-soft text-accent" : "border-line hover:border-accent")}>
                          {c.p}% · <span className="num">{formatINR(c.value)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <span className="grid h-14 w-14 place-items-center rounded-3xl bg-lime text-lime-ink">
                    <IconCheck size={28} strokeWidth={3} />
                  </span>
                  <div>
                    <h1 className="display text-3xl leading-tight font-extrabold">{name.trim() ? `You're set, ${name.trim()}` : "You're set"}</h1>
                    <p className="mt-2 text-muted">Bring your money in. Pick whichever is easiest, you can do the rest later.</p>
                  </div>
                  <div className="grid gap-2">
                    {[
                      { icon: IconTrendUp, title: "Add an investment", sub: "A stock, fund, FD or gold you own", then: "invest" as const },
                      { icon: IconRepeat, title: "Set up SIPs, RDs, chits and EMIs", sub: "With durations and what's left", then: "plans" as const },
                      { icon: IconUpload, title: "Import my spreadsheet", sub: "CSV with a column-mapping screen", then: "import" as const },
                      { icon: IconBanknote, title: "Explore with sample data", sub: "Fictional, removable in one tap", then: "sample" as const },
                    ].map((o) => (
                      <button key={o.title} disabled={busy} onClick={() => void finish(o.then)} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left shadow-card transition hover:border-accent/50 active:scale-[0.99]">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                          <o.icon size={20} />
                        </span>
                        <span>
                          <span className="block text-sm font-bold">{o.title}</span>
                          <span className="block text-xs text-muted">{o.sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
          </motion.div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            Back
          </Button>
          {step < STEPS - 1 ? (
            <Button variant="primary" size="lg" onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
              I'll do it later
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
