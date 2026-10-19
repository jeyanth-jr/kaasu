import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Win, WinKind, WinTier } from "../domain/savings";
import { cx } from "./components";
import { IconFlame, IconParty, IconShield, IconSparkles, IconTarget, IconTrendUp, IconTrophy, IconX } from "./icons";

/**
 * Celebrations: a toast, confetti and a buzz, scaled to how big the win is.
 * Everything respects prefers-reduced-motion (the toast still appears; the confetti doesn't).
 */

type Listener = (w: Win) => void;
const listeners = new Set<Listener>();

const COLORS = ["#e3b94d", "#f6dc8a", "#2f62a8", "#17909c", "#3ddba0", "#ffffff"];
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function haptic(tier: WinTier): void {
  try {
    navigator.vibrate?.(tier === "big" ? [30, 50, 30, 50, 90] : tier === "medium" ? [25, 40, 25] : 15);
  } catch {
    /* unsupported */
  }
}

export function fireConfetti(tier: WinTier): void {
  if (reduced()) return;
  if (tier === "small") {
    void confetti({ particleCount: 45, spread: 65, startVelocity: 32, origin: { x: 0.5, y: 0.12 }, colors: COLORS, scalar: 0.9, ticks: 140, disableForReducedMotion: true });
    return;
  }
  if (tier === "medium") {
    void confetti({ particleCount: 70, angle: 60, spread: 75, origin: { x: 0, y: 0.75 }, colors: COLORS, disableForReducedMotion: true });
    void confetti({ particleCount: 70, angle: 120, spread: 75, origin: { x: 1, y: 0.75 }, colors: COLORS, disableForReducedMotion: true });
    return;
  }
  // Big: a centre burst, then side cannons for about a second and a half.
  void confetti({ particleCount: 160, spread: 100, startVelocity: 48, origin: { x: 0.5, y: 0.6 }, colors: COLORS, scalar: 1.1, disableForReducedMotion: true });
  const end = Date.now() + 1500;
  const tick = () => {
    void confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
    void confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: COLORS, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(tick);
  };
  tick();
}

/** Show a win: toast + confetti + haptics. Callers decide whether the user has celebrations switched on. */
export function celebrate(w: Win): void {
  for (const l of listeners) l(w);
  fireConfetti(w.tier);
  haptic(w.tier);
}

const KIND_ICON: Record<WinKind, typeof IconTarget> = { goal: IconTarget, streak: IconFlame, first: IconSparkles, networth: IconTrendUp, emergency: IconShield };
export const winIcon = (kind: WinKind) => KIND_ICON[kind];

let nextId = 0;

export function CelebrationHost() {
  const [items, setItems] = useState<(Win & { id: number })[]>([]);

  useEffect(() => {
    const onWin: Listener = (w) => {
      const id = ++nextId;
      setItems((cur) => [...cur.slice(-2), { ...w, id }]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== id)), w.tier === "big" ? 7000 : w.tier === "medium" ? 5000 : 3800);
    };
    listeners.add(onWin);
    return () => void listeners.delete(onWin);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-[70] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {items.map((w) => {
          const Icon = w.tier === "big" ? IconTrophy : KIND_ICON[w.kind];
          const big = w.tier === "big";
          return (
            <motion.div
              key={w.id}
              role="status"
              layout
              initial={{ opacity: 0, y: -28, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              onClick={() => setItems((cur) => cur.filter((x) => x.id !== w.id))}
              className={cx(
                "pointer-events-auto flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-3xl border p-3.5 pr-4 shadow-2xl backdrop-blur-xl",
                big ? "border-gold/60 bg-hero text-white" : "border-line bg-surface/95 text-ink",
              )}
            >
              <motion.span
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.08 }}
                className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", big ? "bg-gold text-gold-ink" : "bg-accent-soft text-accent")}
              >
                <Icon size={24} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className={cx("text-[11px] font-bold tracking-wider uppercase", big ? "text-gold" : "text-accent")}>{big ? "Big win" : w.tier === "medium" ? "Nice one" : "Milestone"}</div>
                <div className="display truncate text-lg leading-tight font-extrabold">{w.title}</div>
                <div className={cx("text-xs", big ? "text-white/80" : "text-muted")}>{w.detail}</div>
              </div>
              <IconX size={14} className="shrink-0 opacity-50" aria-hidden />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Small decorative sparkle burst used behind the goal ring when it's complete. */
export function SparkleBurst() {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      {Array.from({ length: 6 }, (_, i) => (
        <motion.span
          key={i}
          className="absolute text-gold"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1, 0.4], x: Math.cos((i / 6) * Math.PI * 2) * 74, y: Math.sin((i / 6) * Math.PI * 2) * 74 }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.4, delay: i * 0.12 }}
        >
          <IconParty size={14} />
        </motion.span>
      ))}
    </div>
  );
}
