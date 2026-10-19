import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { saveSettings } from "./db/db";
import { daysBetween, todayISO } from "./domain/dates";
import { refreshPrices, type RefreshReport } from "./prices/client";
import { AddTransactionSheet } from "./ui/AddTransaction";
import { Button, cx } from "./ui/components";
import { DataProvider, useData } from "./ui/data";
import {
  IconCalendar,
  IconEye,
  IconEyeOff,
  IconHome,
  IconLayers,
  IconList,
  IconMoon,
  IconPie,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSettings,
  IconSun,
} from "./ui/icons";
import { AllocationPage } from "./pages/Allocation";
import { CalendarPage } from "./pages/Calendar";
import { DashboardPage } from "./pages/Dashboard";
import { HoldingDetailPage } from "./pages/HoldingDetail";
import { HoldingsPage } from "./pages/Holdings";
import { SettingsPage } from "./pages/Settings";
import { TaxPage } from "./pages/Tax";
import { TransactionsPage } from "./pages/Transactions";

// ---------------------------------------------------------------------------
// Global "Add transaction" sheet

interface AddCtx {
  openAdd: (opts?: { instrumentId?: string; txnId?: string }) => void;
}
const AddContext = createContext<AddCtx>({ openAdd: () => {} });
export const useAdd = () => useContext(AddContext);

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
      document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute("content", dark ? "#111615" : "#f4f1ea");
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

const NAV = [
  { to: "/", label: "Dashboard", short: "Home", icon: IconHome },
  { to: "/holdings", label: "Holdings", short: "Holdings", icon: IconLayers },
  { to: "/transactions", label: "Transactions", short: "Txns", icon: IconList },
  { to: "/allocation", label: "Allocation", short: "Alloc", icon: IconPie },
  { to: "/tax", label: "Tax", short: "Tax", icon: IconReceipt },
  { to: "/calendar", label: "Calendar", short: "Calendar", icon: IconCalendar },
  { to: "/settings", label: "Settings", short: "Settings", icon: IconSettings },
];

function Shell({ children }: { children: ReactNode }) {
  const { settings, instruments, ready } = useData();
  const { openAdd } = useAdd();
  const [theme, setTheme] = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<RefreshReport | null>(null);
  const location = useLocation();

  useEffect(() => {
    document.body.classList.toggle("privacy", settings.privacyMode);
  }, [settings.privacyMode]);
  useEffect(() => window.scrollTo(0, 0), [location.pathname]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setReport(await refreshPrices());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!report) return;
    const t = setTimeout(() => setReport(null), 6000);
    return () => clearTimeout(t);
  }, [report]);

  const nextTheme: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const backupAge = settings.lastBackupAt ? daysBetween(settings.lastBackupAt.slice(0, 10), todayISO()) : null;
  const needsBackup = ready && instruments.some((i) => !i.sample) && (backupAge === null || backupAge > 14);

  return (
    <div className="min-h-dvh md:pl-60">
      {/* Desktop side nav */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface/70 px-3 py-5 backdrop-blur md:flex">
        <div className="mb-7 flex items-baseline gap-2 px-3">
          <span className="display text-2xl font-semibold">Kaasu</span>
          <span className="text-xs text-faint">காசு · local</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors", isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink")}
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Button variant="primary" className="mt-6" onClick={() => openAdd()}>
          <IconPlus size={16} /> Add transaction
        </Button>
        <div className="mt-auto px-3 text-[11px] leading-relaxed text-faint">
          Your data lives only in this browser. Back it up from Settings.
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/85 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
          <span className="display text-xl font-semibold md:hidden">Kaasu</span>
          <div className="ml-auto flex items-center gap-1">
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
              {theme === "dark" ? <IconMoon size={17} /> : theme === "light" ? <IconSun size={17} /> : <span className="text-[11px] font-semibold">AUTO</span>}
            </Button>
          </div>
        </div>
        {report && (
          <div className="border-t border-line bg-surface px-4 py-2 text-center text-xs text-muted" role="status">
            {report.message}
          </div>
        )}
        {needsBackup && !report && (
          <NavLink to="/settings#backup" className="block border-t border-warn/30 bg-warn-soft/70 px-4 py-1.5 text-center text-xs text-warn">
            {backupAge === null ? "You haven't backed up yet." : `Last backup ${backupAge} days ago.`} Data lives only in this browser — back up now →
          </NavLink>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 pb-28 sm:px-6 md:pb-12">{children}</main>

      {/* Mobile: FAB + bottom tabs */}
      <button
        onClick={() => openAdd()}
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg md:hidden"
        aria-label="Add transaction"
      >
        <IconPlus size={24} />
      </button>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", isActive ? "text-accent" : "text-faint")}
          >
            <n.icon size={20} />
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const [add, setAdd] = useState<{ open: boolean; instrumentId?: string; txnId?: string }>({ open: false });
  const openAdd = useCallback((opts?: { instrumentId?: string; txnId?: string }) => setAdd({ open: true, ...opts }), []);
  return (
    <DataProvider>
      <AddContext.Provider value={{ openAdd }}>
        <HashRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/holdings" element={<HoldingsPage />} />
              <Route path="/holdings/:id" element={<HoldingDetailPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/allocation" element={<AllocationPage />} />
              <Route path="/tax" element={<TaxPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </Shell>
          <AddTransactionSheet open={add.open} instrumentId={add.instrumentId} txnId={add.txnId} onClose={() => setAdd({ open: false })} />
        </HashRouter>
      </AddContext.Provider>
    </DataProvider>
  );
}
