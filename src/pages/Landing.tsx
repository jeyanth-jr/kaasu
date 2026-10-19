import { motion } from "motion/react";
import { Suspense, lazy, useState } from "react";
import { Link } from "react-router-dom";
import { COMPANY_NAME, PRODUCT_TAGLINE } from "../brand";
import { startDemo } from "../sync/demo";
import { Button } from "../ui/components";
import { Coin3D } from "../ui/Coin";
import { Logo } from "../ui/Logo";
import { IconFlag, IconLandmark, IconPie, IconTarget, IconReceipt, IconRepeat, IconShield, IconTrendUp, IconTrophy, IconWallet } from "../ui/icons";

const SignInForm = lazy(() => import("../sync/SyncPanel").then((m) => ({ default: m.SignInForm })));

const FEATURES = [
  { icon: IconWallet, title: "Payday, planned", text: "When salary lands, one tap lines up SIPs, RDs, EMIs and bills, then tells you exactly what's safe to spend per day.", color: "var(--accent)" },
  { icon: IconRepeat, title: "Every monthly commitment", text: "SIPs, RDs, gold chits and EMIs with their durations, what's left to pay and what frees up when.", color: "var(--c-gold)" },
  { icon: IconFlag, title: "A real debt-free date", text: "Loan balances, interest still to come, and what a prepayment would save, down to the month.", color: "var(--loss)" },
  { icon: IconLandmark, title: "Every bank account", text: "Keep all your balances side by side, and see which account every spend, income and investment went through.", color: "var(--c-cash)" },
  { icon: IconTarget, title: "Short and long-term goals", text: "A trip, a phone, a home: set a target and a date and see what to put aside each month and whether you're on track.", color: "var(--c-debt)" },
  { icon: IconTrendUp, title: "Your whole portfolio", text: "Stocks, funds, deposits, bonds and gold with live prices, XIRR and FIFO lots, all in one net worth.", color: "var(--c-equity)" },
  { icon: IconReceipt, title: "India tax lots", text: "STCG and LTCG by lot, your remaining exemption, and which sales cost you nothing this year.", color: "var(--c-debt)" },
  { icon: IconTrophy, title: "Wins that feel good", text: "A monthly savings goal with milestones, streaks and a little confetti when you hit them.", color: "var(--c-other)" },
];

export function Landing() {
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5">
        <Logo />
        <div className="flex items-center gap-1 text-sm font-semibold">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await startDemo();
            }}
          >
            {busy ? "Loading…" : "Try the demo"}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-5 pt-4 pb-16 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-14 lg:pt-10">
        <section>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Coin3D size={76} className="mb-4" />
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
              <IconShield size={13} /> Private by design · free to start
            </span>
            <h1 className="display mt-4 text-[2.6rem] leading-[1.02] font-extrabold sm:text-6xl">
              Know what's <span className="text-gradient">safe to spend</span>.<br />
              Watch your wealth grow.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{PRODUCT_TAGLINE} Kaasu lines up every rupee when your salary lands, then keeps your investments, loans and goals honest.</p>
          </motion.div>

          <PreviewStack />

          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <motion.li
                key={f.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: (i % 2) * 0.06 }}
                className="glass rounded-3xl p-4"
              >
                <span className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `color-mix(in oklab, ${f.color} 16%, transparent)`, color: f.color }}>
                  <f.icon size={20} />
                </span>
                <h3 className="mt-3 text-[15px] font-bold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted">{f.text}</p>
              </motion.li>
            ))}
          </ul>
        </section>

        <aside className="lg:sticky lg:top-8">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="glass glass-strong rounded-[2rem] p-6 sm:p-7">
            <h2 className="display text-2xl font-extrabold">Create your free account</h2>
            <p className="mt-1 mb-5 text-sm text-muted">Takes a minute. No card, no password.</p>
            <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-sunken" />}>
              <SignInForm hidePrivacy intro="Enter your email and we'll send a sign-in link. If you're new, that creates your account." />
            </Suspense>
            <div className="mt-5 border-t border-line pt-4 text-center">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await startDemo();
                }}
                className="text-sm font-semibold text-accent hover:underline"
              >
                {busy ? "Loading the demo…" : "Just looking? Explore a demo with sample data"}
              </button>
            </div>
          </motion.div>
          <ul className="mt-4 flex flex-col gap-2 px-2 text-xs text-muted">
            <li className="flex gap-2">
              <IconShield size={14} className="mt-0.5 shrink-0 text-accent" /> Encrypted in transit and at rest, locked to your login. No ads, and your data is never sold.
            </li>
            <li className="flex gap-2">
              <IconPie size={14} className="mt-0.5 shrink-0 text-accent" /> Export a backup or delete your account and all your data any time.
            </li>
          </ul>
        </aside>
      </main>

      <footer className="border-t border-line/70 px-5 py-6 text-center text-xs text-muted">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-semibold">
          <Link to="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink">
            Terms
          </Link>
          <span>© {new Date().getFullYear()} {COMPANY_NAME}</span>
        </div>
        <p className="mx-auto mt-2 max-w-xl text-faint">Kaasu is a personal finance tracker, not investment, tax or legal advice, and not a SEBI-registered adviser. Prices come from public sources and may be delayed.</p>
      </footer>
    </div>
  );
}

/** Decorative preview built from the same look as the real app. */
function PreviewStack() {
  return (
    <div className="relative mt-9 h-[21rem] sm:h-80" aria-hidden>
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-0 left-0 w-[78%] max-w-sm rounded-[1.75rem] bg-hero p-5"
      >
        <div className="text-xs font-semibold text-white/80">Safe to spend this month</div>
        <div className="display mt-1 text-4xl font-extrabold num">₹19,334</div>
        <div className="mt-2 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">≈ ₹1,487 / day for 13 days</div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20">
          <div className="h-full w-[62%] rounded-full bg-gold" />
        </div>
      </motion.div>

      <motion.div animate={{ y: [0, 9, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.6 }} className="absolute top-12 right-0 w-[52%] max-w-[15rem] glass rounded-3xl p-4">
        <div className="flex items-center gap-3">
          <svg width="54" height="54" viewBox="0 0 120 120" className="-rotate-90 shrink-0">
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--sunken)" strokeWidth="14" />
            <circle cx="60" cy="60" r="48" fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round" strokeDasharray="301" strokeDashoffset="95" />
          </svg>
          <div>
            <div className="text-xs font-semibold text-muted">Savings goal</div>
            <div className="display text-xl font-extrabold num">68%</div>
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold px-2.5 py-1 text-[11px] font-bold text-gold-ink">
          <IconTrophy size={12} /> 2-month streak
        </div>
      </motion.div>

      <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 1.1 }} className="absolute bottom-0 left-[12%] w-[62%] max-w-xs glass rounded-3xl p-4">
        <div className="flex items-center justify-between text-xs font-semibold text-muted">
          <span>Home loan</span>
          <span>214 EMIs left</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
          <div className="h-full w-[18%] rounded-full bg-gain" />
        </div>
        <div className="mt-2 text-xs text-muted">
          Debt-free <b className="text-ink">Aug 2044</b> · prepay ₹5,000/mo to finish <b className="text-gain">6 years sooner</b>
        </div>
      </motion.div>
    </div>
  );
}
