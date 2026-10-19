import { motion } from "motion/react";
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { saveSettings } from "./db/db";
import { paydayStatus, type EntryKind } from "./domain/cashflow";
import { daysBetween, todayISO } from "./domain/dates";
import { refreshPrices, type RefreshReport } from "./prices/client";
import { AddTransactionSheet } from "./ui/AddTransaction";
import { CelebrationHost } from "./ui/celebrate";
import { useSavingsTracker } from "./ui/useSavings";
import { Button, Sheet, cx } from "./ui/components";
import { DataProvider, useData } from "./ui/data";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import {
  IconAuto,
  IconCalendar,
  IconEye,
  IconEyeOff,
  IconHome,
  IconLayers,
  IconList,
  IconMoon,
  IconPie,
  IconBanknote,
  IconBriefcase,
  IconHelp,
  IconLandmark,
  IconTarget,
  IconPlus,
  IconReceipt,
  IconReceiptPlain,
  IconTrendUp,
  IconRepeat,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSun,
  IconWallet,
} from "./ui/icons";
import { EntrySheet, PaydaySheet } from "./ui/MoneySheets";
import { AccountButton } from "./sync/AccountButton";
import { syncConfigured } from "./sync/config";
import { endDemo, useDemo } from "./sync/demo";
import { useSyncActive, useSyncState } from "./sync/state";
import { Logo } from "./ui/Logo";
import { Onboarding } from "./ui/Onboarding";
import { CommandPalette, usePaletteShortcut } from "./ui/CommandPalette";
import { Tour, TourAutoStart } from "./ui/Tour";

// Pages load on demand so the first screen arrives quickly on a phone.
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const MoneyPage = lazy(() => import("./pages/Money").then((m) => ({ default: m.MoneyPage })));
const PlansPage = lazy(() => import("./pages/Plans").then((m) => ({ default: m.PlansPage })));
const HoldingsPage = lazy(() => import("./pages/Holdings").then((m) => ({ default: m.HoldingsPage })));
const HoldingDetailPage = lazy(() => import("./pages/HoldingDetail").then((m) => ({ default: m.HoldingDetailPage })));
const TransactionsPage = lazy(() => import("./pages/Transactions").then((m) => ({ default: m.TransactionsPage })));
const AllocationPage = lazy(() => import("./pages/Allocation").then((m) => ({ default: m.AllocationPage })));
const TaxPage = lazy(() => import("./pages/Tax").then((m) => ({ default: m.TaxPage })));
const CalendarPage = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.CalendarPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const LandingPage = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const AccountsPage = lazy(() => import("./pages/Accounts").then((m) => ({ default: m.AccountsPage })));
const GoalsPage = lazy(() => import("./pages/Goals").then((m) => ({ default: m.GoalsPage })));
const HelpPage = lazy(() => import("./pages/Help").then((m) => ({ default: m.HelpPage })));
const LegalPage = lazy(() => import("./pages/Legal").then((m) => ({ default: m.LegalPage })));

// ---------------------------------------------------------------------------
// Global add actions (investment transaction, money entry, payday)

interface AddCtx {
  openTour: () => void;
  openPalette: () => void;
  openAdd: (opts?: { instrumentId?: string; txnId?: string }) => void;
  openMoney: (kind: EntryKind) => void;
  openPayday: () => void;
  openChooser: () => void;
}
const AddContext = createContext<AddCtx>({ openTour: () => {}, openPalette: () => {}, openAdd: () => {}, openMoney: () => {}, openPayday: () => {}, openChooser: () => {} });
export const useAdd = () => useContext(AddContext);
export const useTour = () => useContext(AddContext);

// ---------------------------------------------------------------------------
// Theme (per-device preference)

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("kaasu.theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", dark ? "#06080e" : "#f2efe8");
    };
    apply();
    try {
      localStorage.setItem("kaasu.theme", theme);
    } catch {
      /* private mode */
    }
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme];
}

const EVERYDAY = [
  { to: "/", label: "Home", icon: IconHome },
  { to: "/money", label: "Money", icon: IconWallet },
  { to: "/accounts", label: "Accounts", icon: IconLandmark },
  { to: "/goals", label: "Goals", icon: IconTarget },
  { to: "/plans", label: "Plans & debt", icon: IconRepeat },
];
const INVEST = [
  { to: "/holdings", label: "Holdings", icon: IconLayers },
  { to: "/transactions", label: "Transactions", icon: IconList },
  { to: "/allocation", label: "Allocation", icon: IconPie },
  { to: "/tax", label: "Tax", icon: IconReceipt },
  { to: "/calendar", label: "Calendar & plan", icon: IconCalendar },
];
const MORE = [{ to: "/accounts", label: "Accounts", icon: IconLandmark }, { to: "/goals", label: "Goals", icon: IconTarget }, { to: "/plans", label: "Plans & debt", icon: IconRepeat }, ...INVEST.slice(1), { to: "/help", label: "Help & tour", icon: IconHelp }, { to: "/settings", label: "Settings", icon: IconSettings }];

function SideLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof IconHome }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cx("group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors", isActive ? "text-accent" : "text-muted hover:bg-sunken hover:text-ink")
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-pill" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-2xl bg-accent-soft shadow-[inset_0_1px_0_rgb(255_255_255/0.4)]" />}
          <Icon size={19} className="relative" strokeWidth={isActive ? 2.4 : 2} />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { settings, instruments, ready } = useData();
  const { openChooser, openPalette } = useAdd();
  useSavingsTracker();
  const [theme, setTheme] = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [more, setMore] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.body.classList.toggle("privacy", settings.privacyMode);
  }, [settings.privacyMode]);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMore(false);
  }, [location.pathname]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setReport(await refreshPrices());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Keep the banner up when something needs attention; otherwise fade after a few seconds.
    if (!report || report.missing.length > 0 || report.failed.length > 0) return;
    const t = setTimeout(() => setReport(null), 6000);
    return () => clearTimeout(t);
  }, [report]);

  const nextTheme: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const backupAge = settings.lastBackupAt ? daysBetween(settings.lastBackupAt.slice(0, 10), todayISO()) : null;
  const syncing = useSyncActive();
  const demo = useDemo();
  const needsBackup = ready && !syncing && instruments.some((i) => !i.sample) && (backupAge === null || backupAge > 14);
  const moreActive = MORE.some((m) => location.pathname.startsWith(m.to));

  return (
    <div className="min-h-dvh md:pl-64">
      {/* Desktop side nav */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 flex-col !rounded-none !border-y-0 !border-l-0 px-4 py-6 md:flex">
        <div className="mb-8 px-2">
          <Logo />
        </div>
        <nav className="flex flex-col gap-1">
          {EVERYDAY.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
          <div className="mt-5 mb-1 px-3 text-[11px] font-bold tracking-wider text-faint uppercase">Invest</div>
          {INVEST.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
        </nav>
        <Button variant="primary" size="lg" className="mt-6" onClick={openChooser}>
          <IconPlus size={18} strokeWidth={2.6} /> Add
        </Button>
        <div className="mt-auto flex flex-col gap-1">
          <SideLink to="/help" label="Help & tour" icon={IconHelp} />
          <SideLink to="/settings" label="Settings" icon={IconSettings} />
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-paper/45 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:px-6">
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={openPalette} aria-label="Search and commands" title="Search (Ctrl K or /)">
              <IconSearch size={17} />
              <span className="hidden items-center gap-1 lg:inline-flex">
                Search <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-faint">Ctrl K</kbd>
              </span>
            </Button>
            <Button variant="ghost" size="sm" onClick={doRefresh} disabled={refreshing} aria-label="Refresh prices" title="Refresh prices">
              <IconRefresh size={17} className={refreshing ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Prices"}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void saveSettings({ privacyMode: !settings.privacyMode })}
              aria-label={settings.privacyMode ? "Show amounts" : "Hide amounts"}
              title={settings.privacyMode ? "Show amounts" : "Hide amounts"}
            >
              {settings.privacyMode ? <IconEyeOff size={17} /> : <IconEye size={17} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`} title={`Theme: ${theme}`}>
              {theme === "dark" ? <IconMoon size={17} /> : theme === "light" ? <IconSun size={17} /> : <IconAuto size={17} />}
            </Button>
            <AccountButton />
          </div>
        </div>
        {report && (
          <div className="flex items-start justify-center gap-3 border-y border-line/60 bg-surface/60 px-4 py-2 text-xs text-muted backdrop-blur-xl" role="status">
            <span>
              {report.message}
              {report.missing.length > 0 && (
                <>
                  {" "}
                  <NavLink to="/holdings?link=1" className="font-semibold text-accent" onClick={() => setReport(null)}>
                    Link them →
                  </NavLink>
                </>
              )}
            </span>
            <button onClick={() => setReport(null)} className="shrink-0 text-faint hover:text-ink" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
        {demo && !report && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-y border-accent/25 bg-accent-soft px-4 py-2 text-center text-xs font-semibold text-accent">
            You're exploring a demo with sample data.
            <button className="underline underline-offset-2" onClick={() => void endDemo()}>
              Create a free account →
            </button>
          </div>
        )}
        {needsBackup && !report && !demo && (
          <NavLink to="/settings#backup" className="block border-y border-warn/30 bg-warn-soft px-4 py-1.5 text-center text-xs font-semibold text-warn">
            {backupAge === null ? "No backup yet." : `Last backup ${backupAge} days ago.`} Your data only lives on this device. Back it up →
          </NavLink>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-3 pb-32 sm:px-6 md:pb-12">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<div className="py-20 text-center text-sm text-muted">Loading…</div>}>
            {/* Enter-only transition: an exit animation can strand lazy routes mid-fade. */}
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              {children}
            </motion.div>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Mobile: floating tab bar with a raised add button */}
      <nav className="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 items-center rounded-[1.75rem] px-1 py-1.5 md:hidden">
        <TabLink to="/" label="Home" icon={IconHome} />
        <TabLink to="/money" label="Money" icon={IconWallet} />
        <div className="flex justify-center">
          <motion.button whileTap={{ scale: 0.9 }} onClick={openChooser} className="-mt-7 grid h-14 w-14 place-items-center rounded-[1.1rem] bg-gradient-to-br from-[#f8e29c] via-[#e3b94d] to-[#b98a35] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_12px_24px_-8px_rgb(185_138_53/0.7)]" aria-label="Add">
            <IconPlus size={26} strokeWidth={2.8} className="text-[#2a1d05]" />
          </motion.button>
        </div>
        <TabLink to="/holdings" label="Invest" icon={IconLayers} />
        <button onClick={() => setMore(true)} className={cx("flex flex-col items-center gap-0.5 py-1 text-[10px] font-semibold", moreActive ? "text-accent" : "text-faint")}>
          <IconSparkles size={21} />
          More
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {MORE.map((m) => (
            <button key={m.to} onClick={() => navigate(m.to)} className="glass flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-semibold">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                <m.icon size={18} />
              </span>
              {m.label}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function TabLink({ to, label, icon: Icon }: { to: string; label: string; icon: typeof IconHome }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => cx("relative flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold", isActive ? "text-accent" : "text-faint")}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="tab-pill" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-x-1 inset-y-0.5 rounded-2xl bg-accent-soft" />}
          <Icon size={21} strokeWidth={isActive ? 2.5 : 2} className="relative" />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function AddChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openAdd, openMoney, openPayday } = useAdd();
  const { settings, cash, asOf } = useData();
  const navigate = useNavigate();
  const pd = paydayStatus(settings.salary, cash, asOf);
  const tiles = [
    { label: "Spent", sub: "Log an expense", icon: IconReceiptPlain, onClick: () => openMoney("expense"), tone: "from-[#c4495f] to-[#e48a5a]" },
    { label: "Got money", sub: "Income, refund", icon: IconBanknote, onClick: () => openMoney("income"), tone: "from-[#0f8a63] to-[#3fb58a]" },
    { label: "Investment", sub: "Buy, sell, SIP, FD…", icon: IconTrendUp, onClick: () => openAdd(), tone: "from-[#1f4a8c] to-[#c79a3b]" },
    { label: "New goal", sub: "Save for something", icon: IconTarget, onClick: () => navigate("/goals?new=1"), tone: "from-[#17707c] to-[#5aa9a0]" },
    ...(pd.state === "due" || pd.state === "upcoming" ? [{ label: "Salary in", sub: "Run payday", icon: IconBriefcase, onClick: () => openPayday(), tone: "from-[#17707c] to-[#2f62a8]" }] : []),
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Add something">
      <div className="grid grid-cols-2 gap-3 pb-2">
        {tiles.map((t, i) => (
          <motion.button
            key={t.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              onClose();
              setTimeout(t.onClick, 120);
            }}
            className={cx("flex flex-col items-start gap-6 rounded-3xl bg-gradient-to-br p-4 text-left text-white shadow-card", t.tone)}
          >
            <t.icon size={30} strokeWidth={2.2} />
            <span>
              <span className="block text-base font-extrabold">{t.label}</span>
              <span className="block text-xs font-medium text-white/85">{t.sub}</span>
            </span>
          </motion.button>
        ))}
      </div>
    </Sheet>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Logo className="animate-pulse" />
        <span className="text-xs font-semibold text-faint">Opening your account…</span>
      </div>
    </div>
  );
}

/**
 * With cloud accounts configured this is a service: visitors who aren't signed in see the landing
 * page (and the legal pages) instead of the app, unless they've chosen the demo.
 */
function Gate({ children }: { children: ReactNode }) {
  const s = useSyncState();
  const demo = useDemo();
  const { pathname } = useLocation();
  if (!syncConfigured) return <>{children}</>;
  if (s.status === "loading") return <Splash />;
  if (s.status === "signed-out" && !demo) {
    const legal = pathname === "/privacy" ? "privacy" : pathname === "/terms" ? "terms" : null;
    return (
      <Suspense fallback={<Splash />}>
        {legal ? <LegalPage doc={legal} standalone /> : <LandingPage />}
      </Suspense>
    );
  }
  return <>{children}</>;
}

export function App() {
  const [add, setAdd] = useState<{ open: boolean; instrumentId?: string; txnId?: string }>({ open: false });
  const [money, setMoney] = useState<EntryKind | null>(null);
  const [payday, setPayday] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [tour, setTour] = useState(false);
  const [palette, setPalette] = useState(false);
  const togglePalette = useCallback(() => setPalette((p) => !p), []);
  usePaletteShortcut(togglePalette);
  const ctx: AddCtx = {
    openTour: useCallback(() => setTour(true), []),
    openPalette: togglePalette,
    openAdd: useCallback((opts?: { instrumentId?: string; txnId?: string }) => setAdd({ open: true, ...opts }), []),
    openMoney: useCallback((k: EntryKind) => setMoney(k), []),
    openPayday: useCallback(() => setPayday(true), []),
    openChooser: useCallback(() => setChooser(true), []),
  };
  return (
    <DataProvider>
      <AddContext.Provider value={ctx}>
        <HashRouter>
          <Gate>
          <Shell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/money" element={<MoneyPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route path="/plans" element={<PlansPage />} />
              <Route path="/holdings" element={<HoldingsPage />} />
              <Route path="/holdings/:id" element={<HoldingDetailPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/allocation" element={<AllocationPage />} />
              <Route path="/tax" element={<TaxPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/privacy" element={<LegalPage doc="privacy" />} />
              <Route path="/terms" element={<LegalPage doc="terms" />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </Shell>
          <CelebrationHost />
          <AddChooser open={chooser} onClose={() => setChooser(false)} />
          <AddTransactionSheet open={add.open} instrumentId={add.instrumentId} txnId={add.txnId} onClose={() => setAdd({ open: false })} />
          <EntrySheet open={money !== null} kind={money ?? "expense"} onClose={() => setMoney(null)} />
          <PaydaySheet open={payday} onClose={() => setPayday(false)} />
          <Onboarding />
          <TourAutoStart onOpen={() => setTour(true)} />
          <Tour open={tour} onClose={() => setTour(false)} />
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
          </Gate>
        </HashRouter>
      </AddContext.Provider>
    </DataProvider>
  );
}
