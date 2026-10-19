import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { undoLast, useUndoStack } from "../db/undo";
import { IconUndo } from "./icons";

/** "Salary confirmed · Undo": appears after any change for a few seconds. Ctrl/⌘ Z undoes too. */
export function UndoHost() {
  const stack = useUndoStack();
  const top = stack.at(-1);
  const [shownId, setShownId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!top) return setShownId(null);
    setShownId(top.id);
    const t = setTimeout(() => setShownId((cur) => (cur === top.id ? null : cur)), 9000);
    return () => clearTimeout(t);
  }, [top?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        void undoLast();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!top || shownId !== top.id) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[65] flex justify-center px-4 md:bottom-8" aria-live="polite">
      <motion.div initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 32 }} className="glass glass-strong pointer-events-auto flex items-center gap-3 rounded-full py-2 pr-2 pl-5 text-sm font-semibold">
        <span>{top.label}</span>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await undoLast();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-accent-ink transition active:scale-95 disabled:opacity-60"
        >
          <IconUndo size={14} /> Undo
        </button>
      </motion.div>
    </div>,
    document.body,
  );
}
