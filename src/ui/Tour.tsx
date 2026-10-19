import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveSettings } from "../db/db";
import { syncConfigured } from "../sync/config";
import { useDemo } from "../sync/demo";
import { useSyncState } from "../sync/state";
import { Button, Sheet, cx } from "./components";
import { useData } from "./data";
import { IconCloud, IconFlag, IconHome, IconLandmark, IconLayers, IconPlus, IconRepeat, IconTarget, IconTrophy, IconUpload, IconWallet } from "./icons";

interface Slide {
  icon: typeof IconHome;
  color: string;
  title: string;
  lead: string;
  points: string[];
  actions?: { label: string; to: string; primary?: boolean }[];
}

const SLIDES: Slide[] = [
  {
    icon: IconHome,
    color: "var(--accent)",
    title: "Home: your money at a glance",
    lead: "One screen for where you stand today.",
    points: ["Net worth, today's change and your overall XIRR.", "Quick actions to log a spend, income or an investment in two taps.", "Your savings goal ring, this month's safe-to-spend, and things worth a look."],
  },
  {
    icon: IconWallet,
    color: "var(--gain)",
    title: "Money: salary in, spending out",
    lead: "Know exactly what's safe to spend.",
    points: [
      "On payday Kaasu asks \"did your salary land?\" and lines up SIPs, RDs, EMIs and bills.",
      "Safe-to-spend per day for the rest of the month, after everything you've committed.",
      "Category budgets: tap one to filter the month's entries. Import a bank statement to fill in history.",
    ],
  },
  {
    icon: IconLandmark,
    color: "var(--c-cash)",
    title: "Accounts: every bank balance",
    lead: "Track as many accounts as you have, and where each rupee went.",
    points: [
      "Add each bank account or wallet with today's balance. They all show side by side with a total.",
      "On every spend, income and investment you pick the account. Its balance moves, and its statement lists each transaction.",
      "Transfers between your own accounts never count as spending. \"Match bank balance\" fixes drift in one tap.",
    ],
    actions: [{ label: "Add a bank account", to: "/accounts?new=1", primary: true }],
  },
  {
    icon: IconTarget,
    color: "var(--c-debt)",
    title: "Goals: short and long term",
    lead: "Save for a trip, a phone, a home or retirement.",
    points: [
      "Set a target and a date. Kaasu works out what to put aside each month and whether you're on track.",
      "Add money as you go, or link holdings so a goal grows with the market. Milestones celebrate.",
      "Short term means up to three years out; long term is anything further.",
    ],
    actions: [{ label: "Set a goal", to: "/goals?new=1", primary: true }],
  },
  {
    icon: IconRepeat,
    color: "var(--c-gold)",
    title: "Plans & debt",
    lead: "Every monthly commitment, with how long it runs.",
    points: ["SIPs, RDs, gold chits and EMIs: instalments done and left, what's still to pay, and the end date.", "A timeline of what frees up when each one ends.", "Debt: balances, a debt-free date and a prepayment what-if that shows the interest and months you'd save."],
  },
  {
    icon: IconLayers,
    color: "var(--c-equity)",
    title: "Invest: holdings, allocation and tax",
    lead: "Everything you own, with real numbers.",
    points: [
      "Holdings with live prices (each shows its date and source), P/L and XIRR per holding.",
      "Allocation against your target bands, and how to split new money to rebalance without selling.",
      "Tax lots: when each lot turns long-term, realised gains this year, and sales that cost you no tax.",
    ],
  },
  {
    icon: IconTrophy,
    color: "var(--c-other)",
    title: "Monthly savings goal and wins",
    lead: "Saving should feel good.",
    points: ["Set a monthly savings goal. The ring fills as you invest, SIP or deposit.", "Milestones at 25, 50, 75 and 100% celebrate with confetti. So do streaks, net-worth levels and emergency-fund runway.", "Tap the ring to replay a celebration, or open Wins to see what you've earned."],
  },
  {
    icon: IconPlus,
    color: "var(--accent)",
    title: "The + button adds anything",
    lead: "Always one tap away, on every screen.",
    points: ["Spent: log an expense. Got money: income or a refund. Pick the account it went through.", "Investment: buy, sell, SIP, deposit, interest. Type a stock name or fund name and pick it.", "Press Ctrl K (or /) anywhere to search holdings, goals and accounts, or start any action."],
  },
  {
    icon: IconUpload,
    color: "var(--c-debt)",
    title: "Bring your data in",
    lead: "Pick whichever is easiest. You can mix them.",
    points: [
      "A spreadsheet of your holdings or trades (CSV): map the columns once and import.",
      "A bank statement (CSV): every line is sorted into a category, and importing twice never double-counts.",
      "Or add things by hand. The Help page has the exact columns, an example file and fixes for common problems.",
    ],
    actions: [
      { label: "Import a spreadsheet", to: "/settings#import", primary: true },
      { label: "Import a bank statement", to: "/money?statement=1" },
      { label: "Read the import guide", to: "/help#import" },
    ],
  },
  {
    icon: IconCloud,
    color: "var(--gain)",
    title: "Safe, synced, yours",
    lead: "Your account keeps everything backed up.",
    points: ["Your data syncs across your phone and laptop. The cloud icon in the top bar shows the status.", "The eye icon blurs every amount when someone's looking over your shoulder.", "Export a backup, or delete your account and all your data, any time in Settings. You can replay this tour from Help."],
  },
];

/** Product tour: a short walkthrough of every area, ending with how to import data. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const slide = SLIDES[i]!;
  const last = i === SLIDES.length - 1;

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const finish = (to?: string) => {
    void saveSettings({ toured: true });
    onClose();
    if (to) navigate(to);
  };

  return (
    <Sheet
      open={open}
      onClose={() => finish()}
      title={
        <span className="flex items-center gap-2">
          Quick tour
          <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-semibold text-muted num">
            {i + 1} / {SLIDES.length}
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => finish()}>
            {last ? "Close" : "Skip tour"}
          </Button>
          {i > 0 && <Button onClick={() => setI(i - 1)}>Back</Button>}
          {last ? (
            <Button variant="primary" onClick={() => finish()}>
              Start using Kaasu
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setI(i + 1)}>
              Next
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex gap-1.5" aria-hidden>
        {SLIDES.map((_, n) => (
          <button key={n} onClick={() => setI(n)} tabIndex={-1} className={cx("h-1.5 flex-1 rounded-full transition-colors", n <= i ? "bg-accent" : "bg-sunken")} />
        ))}
      </div>
      <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4 pb-2">
        <span className="grid h-14 w-14 place-items-center rounded-3xl" style={{ background: `color-mix(in oklab, ${slide.color} 16%, transparent)`, color: slide.color }}>
          <slide.icon size={28} />
        </span>
        <div>
          <h3 className="display text-2xl leading-tight font-extrabold">{slide.title}</h3>
          <p className="mt-1 text-sm text-muted">{slide.lead}</p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {slide.points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm">
              <IconFlag size={15} className="mt-0.5 shrink-0" style={{ color: slide.color }} />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        {slide.actions && (
          <div className="flex flex-wrap gap-2 pt-1">
            {slide.actions.map((a) => (
              <Button key={a.label} variant={a.primary ? "primary" : "secondary"} size="sm" onClick={() => finish(a.to)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </motion.div>
    </Sheet>
  );
}

/**
 * Opens the tour once for a signed-in user with a set-up account, after any first-run setup
 * and once nothing else is open. Marking it seen is stored in settings so every device agrees.
 */
export function TourAutoStart({ onOpen }: { onOpen: () => void }) {
  const { ready, settings, instruments, cash } = useData();
  const sync = useSyncState();
  const demo = useDemo();
  const settled = !syncConfigured || sync.status === "idle";
  const setUp = settings.onboarded === true || instruments.length > 0 || cash.length > 0;
  const eligible = ready && settled && !demo && setUp && !settings.toured;

  useEffect(() => {
    if (!eligible) return;
    // Wait for any open sheet (e.g. the first-run action) to close before interrupting.
    const t = setInterval(() => {
      if (!document.querySelector('[role="dialog"]')) {
        clearInterval(t);
        onOpen();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [eligible, onOpen]);

  return null;
}

