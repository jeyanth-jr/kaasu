import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAdd } from "../App";
import { saveSettings } from "../db/db";
import { undoLast, useUndoStack } from "../db/undo";
import { cx } from "./components";
import { useData } from "./data";
import {
  IconBanknote,
  IconCalendar,
  IconEye,
  IconFlag,
  IconHelp,
  IconHome,
  IconLandmark,
  IconLayers,
  IconList,
  IconPie,
  IconPlus,
  IconReceipt,
  IconReceiptPlain,
  IconRepeat,
  IconSearch,
  IconSettings,
  IconTarget,
  IconTransfer,
  IconUndo,
  IconTrendUp,
  IconWallet,
} from "./icons";
import { goalIcon } from "./goalStyle";

interface Command {
  id: string;
  group: "Actions" | "Go to" | "Holdings" | "Goals" | "Accounts";
  label: string;
  hint?: string;
  icon: typeof IconHome;
  run: () => void;
  /** Extra words that should find this command. */
  words?: string;
}

function score(c: Command, terms: string[]): number {
  const hay = `${c.label} ${c.hint ?? ""} ${c.words ?? ""}`.toLowerCase();
  let s = 0;
  for (const t of terms) {
    const i = hay.indexOf(t);
    if (i < 0) return -1;
    s += i === 0 || hay[i - 1] === " " ? 3 : 1;
  }
  return s + (c.group === "Actions" ? 0.5 : 0);
}

/** Ctrl/⌘ + K: jump anywhere or start any action without hunting through menus. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { instruments, goals, settings } = useData();
  const { openMoney, openAdd, openPayday, openTour } = useAdd();
  const navigate = useNavigate();
  const lastChange = useUndoStack().at(-1);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const cmds: Command[] = [
      ...(lastChange ? [{ id: "a-undo", group: "Actions" as const, label: `Undo: ${lastChange.label}`, icon: IconUndo, run: () => void undoLast(), words: "revert back" }] : []),
      { id: "a-spend", group: "Actions", label: "Log a spend", icon: IconReceiptPlain, run: () => openMoney("expense"), words: "expense paid add" },
      { id: "a-income", group: "Actions", label: "Log money received", icon: IconBanknote, run: () => openMoney("income"), words: "income salary refund add" },
      { id: "a-invest", group: "Actions", label: "Add an investment", icon: IconTrendUp, run: () => openAdd(), words: "buy sell sip stock fund transaction" },
      { id: "a-goal", group: "Actions", label: "New goal", icon: IconTarget, run: go("/goals?new=1"), words: "save target" },
      { id: "a-account", group: "Actions", label: "Add a bank account", icon: IconLandmark, run: go("/accounts?new=1"), words: "bank balance" },
      { id: "a-transfer", group: "Actions", label: "Transfer between accounts", icon: IconTransfer, run: go("/accounts?transfer=1"), words: "move money" },
      { id: "a-payday", group: "Actions", label: "Run payday", icon: IconWallet, run: openPayday, words: "salary" },
      { id: "a-import", group: "Actions", label: "Import a CSV", icon: IconPlus, run: go("/settings#import"), words: "spreadsheet upload holdings" },
      { id: "a-statement", group: "Actions", label: "Import a bank statement", icon: IconReceiptPlain, run: go("/money?statement=1"), words: "csv upload" },
      { id: "a-privacy", group: "Actions", label: settings.privacyMode ? "Show amounts" : "Hide amounts", icon: IconEye, run: () => void saveSettings({ privacyMode: !settings.privacyMode }), words: "privacy blur" },
      { id: "a-tour", group: "Actions", label: "Replay the tour", icon: IconFlag, run: openTour },
      { id: "g-home", group: "Go to", label: "Home", icon: IconHome, run: go("/") },
      { id: "g-money", group: "Go to", label: "Money", icon: IconWallet, run: go("/money"), words: "budget spending" },
      { id: "g-accounts", group: "Go to", label: "Accounts", icon: IconLandmark, run: go("/accounts"), words: "bank balances" },
      { id: "g-goals", group: "Go to", label: "Goals", icon: IconTarget, run: go("/goals") },
      { id: "g-plans", group: "Go to", label: "Plans & debt", icon: IconRepeat, run: go("/plans"), words: "sip rd emi loan chit" },
      { id: "g-holdings", group: "Go to", label: "Holdings", icon: IconLayers, run: go("/holdings"), words: "invest portfolio" },
      { id: "g-txns", group: "Go to", label: "Transactions", icon: IconList, run: go("/transactions") },
      { id: "g-alloc", group: "Go to", label: "Allocation", icon: IconPie, run: go("/allocation"), words: "rebalance" },
      { id: "g-tax", group: "Go to", label: "Tax", icon: IconReceipt, run: go("/tax"), words: "capital gains harvest" },
      { id: "g-cal", group: "Go to", label: "Calendar & plan", icon: IconCalendar, run: go("/calendar") },
      { id: "g-help", group: "Go to", label: "Help & import guide", icon: IconHelp, run: go("/help#import"), words: "how to" },
      { id: "g-settings", group: "Go to", label: "Settings", icon: IconSettings, run: go("/settings"), words: "backup export theme" },
    ];
    for (const i of instruments) {
      if (i.archived) continue;
      if (i.kind === "cash") cmds.push({ id: `acc-${i.id}`, group: "Accounts", label: i.name, hint: "Bank account", icon: IconLandmark, run: go(`/accounts?open=${i.id}`) });
      else cmds.push({ id: `h-${i.id}`, group: "Holdings", label: i.name, hint: i.kind.toUpperCase(), icon: IconLayers, run: go(`/holdings/${i.id}`) });
    }
    for (const g of goals) if (!g.archived) cmds.push({ id: `goal-${g.id}`, group: "Goals", label: g.name, hint: g.term === "short" ? "Short term" : "Long term", icon: goalIcon(g.icon), run: go(`/goals?open=${g.id}`) });
    return cmds;
  }, [lastChange, instruments, goals, settings.privacyMode, navigate, openMoney, openAdd, openPayday, openTour]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return all.filter((c) => c.group === "Actions" || c.group === "Go to").slice(0, 14);
    return all
      .map((c) => ({ c, s: score(c, terms) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.c);
  }, [all, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const choose = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette unmount first so sheets opened by the command can take focus.
    setTimeout(c.run, 60);
  };

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div className="absolute inset-0 bg-[#050a16]/45 backdrop-blur-md" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 36 }} className="glass glass-strong relative w-full max-w-xl overflow-hidden rounded-3xl">
        <div className="flex items-center gap-3 border-b border-line/70 px-4">
          <IconSearch size={18} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter") (e.preventDefault(), choose(results[active]));
            }}
            placeholder="Search holdings, goals, accounts, or type an action…"
            className="w-full bg-transparent py-4 text-base placeholder:text-faint"
            style={{ outline: "none" }}
            aria-label="Search"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold text-faint sm:block">esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {header && <div className="px-3 pt-2 pb-1 text-[11px] font-bold tracking-wider text-faint uppercase">{c.group}</div>}
                <button
                  data-i={i}
                  onClick={() => choose(c)}
                  onMouseMove={() => setActive(i)}
                  className={cx("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-colors", i === active ? "bg-accent-soft text-accent" : "text-ink")}
                >
                  <c.icon size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-xs font-medium text-faint">{c.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hidden items-center gap-4 border-t border-line/70 px-4 py-2 text-[11px] text-faint sm:flex">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">Press / or Ctrl K anywhere</span>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

/** Opens the palette on Ctrl/⌘ + K, or "/" when not typing. */
export function usePaletteShortcut(toggle: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);
}
