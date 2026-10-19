import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { formatDate } from "../domain/dates";
import { formatCompact, formatINR, formatPct, formatPrice } from "../domain/money";
import type { Paise, PricePoint } from "../domain/types";
import { IconArrowDown, IconArrowUp, IconX } from "./icons";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Numbers

export function Money({ p, compact, sign, decimals, className }: { p: Paise; compact?: boolean; sign?: boolean; decimals?: number; className?: string }) {
  const text = compact ? formatCompact(p, { sign }) : formatINR(p, { sign, decimals });
  return (
    <span className={cx("money num whitespace-nowrap", className)} title={compact ? formatINR(p, { decimals: 2 }) : undefined}>
      {text}
    </span>
  );
}

/** Counts up to the value: a little delight for headline numbers. */
export function AnimatedMoney({ p, className }: { p: Paise; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? p : Math.round(p * 0.92));
  const text = useTransform(mv, (v) => formatINR(Math.round(v)));
  const [out, setOut] = useState(formatINR(p));
  useEffect(() => text.on("change", setOut), [text]);
  useEffect(() => {
    if (reduce) {
      mv.set(p);
      setOut(formatINR(p));
      return;
    }
    const c = animate(mv, p, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [p, mv, reduce]);
  return <span className={cx("money num whitespace-nowrap", className)}>{out}</span>;
}

/** Gain/loss with sign, arrow and colour (never colour alone). */
export function Change({ p, pct, compact, className, hideArrow }: { p: Paise | null; pct?: number | null; compact?: boolean; className?: string; hideArrow?: boolean }) {
  if (p === null) return <span className="text-faint">—</span>;
  const tone = p > 0 ? "text-gain" : p < 0 ? "text-loss" : "text-muted";
  const Arrow = p > 0 ? IconArrowUp : p < 0 ? IconArrowDown : null;
  return (
    <span className={cx("inline-flex items-center gap-0.5 num whitespace-nowrap", tone, className)}>
      {!hideArrow && Arrow && <Arrow size={12} strokeWidth={2.6} className="shrink-0" />}
      <span className="money">{compact ? formatCompact(p, { sign: true }) : formatINR(p, { sign: true })}</span>
      {pct !== undefined && pct !== null && <span className="opacity-80 text-[0.92em]">({formatPct(pct, { sign: true })})</span>}
    </span>
  );
}

export function PctChange({ pct, className, pill }: { pct: number | null; className?: string; pill?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-faint">—</span>;
  const up = pct > 0.0001;
  const down = pct < -0.0001;
  const tone = up ? "text-gain" : down ? "text-loss" : "text-muted";
  if (pill) {
    return (
      <span className={cx("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold num", up ? "bg-gain-soft text-gain" : down ? "bg-loss-soft text-loss" : "bg-sunken text-muted", className)}>
        {up ? <IconArrowUp size={11} strokeWidth={2.8} /> : down ? <IconArrowDown size={11} strokeWidth={2.8} /> : null}
        {up ? "+" : down ? "−" : ""}
        {formatPct(Math.abs(pct))}
      </span>
    );
  }
  return <span className={cx("num whitespace-nowrap", tone, className)}>{formatPct(pct, { sign: true })}</span>;
}

const SOURCE_LABEL: Record<PricePoint["source"], string> = {
  amfi: "AMFI",
  google: "Google Finance",
  yahoo: "Yahoo Finance",
  quote: "Quote",
  manual: "Manual",
  derived: "Derived",
  sample: "Sample",
};

/** A price is never shown without its date and source. */
export function PriceStamp({ point, ageDays, className }: { point: PricePoint | null; ageDays: number | null; className?: string }) {
  if (!point) return <span className={cx("text-xs text-warn", className)}>No price yet</span>;
  const stale = ageDays !== null && ageDays > 7;
  return (
    <span className={cx("text-xs num", stale ? "text-warn" : "text-faint", className)} title={`Fetched ${new Date(point.fetchedAt).toLocaleString("en-IN")}`}>
      <span className="money">{formatPrice(point.price)}</span> · {formatDate(point.date, { year: ageDays !== null && ageDays > 300 })} · {SOURCE_LABEL[point.source]}
      {stale && " · stale"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout

export function Card({ title, action, children, className, pad = true, icon }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean; icon?: ReactNode }) {
  return (
    <section className={cx("min-w-0 rounded-3xl border border-line/80 bg-surface shadow-card", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
          {title && (
            <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-ink">
              {icon && <span className="grid h-7 w-7 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</span>}
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, action, emoji }: { title: string; sub?: ReactNode; action?: ReactNode; emoji?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-[2rem] leading-none font-extrabold sm:text-[2.6rem]">
          {title}
          {emoji && <span className="ml-2 inline-block">{emoji}</span>}
        </h1>
        {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold num">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "gain" | "loss" | "lime"; className?: string }) {
  const tones = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    gain: "bg-gain-soft text-gain",
    loss: "bg-loss-soft text-loss",
    lime: "bg-lime text-lime-ink",
  } as const;
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, children, action, emoji = "🪴" }: { title: string; children?: ReactNode; action?: ReactNode; emoji?: string }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border-2 border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <motion.div initial={{ scale: 0.6, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="mb-3 text-5xl">
        {emoji}
      </motion.div>
      <h3 className="display text-2xl font-bold">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Meter({ value, max, marks, tone = "accent", label, size = "md" }: { value: number; max: number; marks?: { at: number; label: string }[]; tone?: "accent" | "warn" | "brass" | "gain" | "loss" | "lime"; label: string; size?: "sm" | "md" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tones = { accent: "bg-gradient-to-r from-accent to-accent-2", warn: "bg-warn", brass: "bg-brass", gain: "bg-gain", loss: "bg-loss", lime: "bg-lime" } as const;
  const h = size === "sm" ? "h-2" : "h-3";
  return (
    <div className="relative">
      <div className={cx(h, "overflow-hidden rounded-full bg-sunken")} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <motion.div className={cx("h-full rounded-full", tones[tone])} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
      </div>
      {marks?.map((m) => (
        <div key={m.label} className={cx("absolute top-0 w-0.5 rounded bg-ink/50", h)} style={{ left: `${Math.min(100, (m.at / max) * 100)}%` }} title={m.label} />
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  const id = useId();
  return (
    <div role="tablist" className={cx("inline-flex rounded-full bg-sunken p-1 text-sm", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("relative rounded-full px-3 py-1.5 font-semibold transition-colors", value === o.value ? "text-ink" : "text-muted hover:text-ink")}
        >
          {value === o.value && <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-full bg-surface shadow-card" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "lime"; size?: "sm" | "md" | "lg" }) {
  const v = {
    primary: "bg-accent text-accent-ink shadow-[0_8px_20px_-8px_var(--accent)] hover:brightness-110",
    lime: "bg-lime text-lime-ink hover:brightness-105",
    secondary: "border border-line bg-surface hover:border-accent/40 hover:bg-accent-soft/40",
    ghost: "text-muted hover:bg-sunken hover:text-ink",
    danger: "border border-loss/40 text-loss hover:bg-loss-soft",
  }[variant];
  const s = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "px-5 py-3 text-base" : "px-4 py-2 text-sm";
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        v,
        s,
        className,
      )}
      {...rest}
    />
  );
}

export function Field({ label, hint, children, className, error }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; className?: string; error?: string | null }) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <span className="text-xs text-loss">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

const inputCls =
  "w-full min-w-0 rounded-2xl border border-line bg-paper/60 px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition focus:border-accent focus:bg-surface focus:outline-none focus:ring-4 focus:ring-accent/15";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "pr-8", props.className)} />;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}
      >
        <span className={cx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-6" : "left-1")} />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Sheet (bottom sheet on phones, centred dialog on larger screens)

export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,button:not([data-close])")?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
          <motion.div className="absolute inset-0 bg-[#0c0a18]/50 backdrop-blur-sm" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={ref}
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className={cx("relative flex max-h-[92dvh] w-full flex-col rounded-t-[2rem] border border-line bg-surface shadow-2xl sm:rounded-[2rem]", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
            <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 sm:pt-5">
              <h2 className="display text-2xl font-bold">{title}</h2>
              <button data-close onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-sunken text-muted hover:text-ink" aria-label="Close">
                <IconX size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-5 pb-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">{children}</h3>;
}

export function Callout({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "warn" | "accent"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = { neutral: "border-line bg-sunken/60", warn: "border-warn/30 bg-warn-soft", accent: "border-accent/25 bg-accent-soft/70" }[tone];
  return (
    <div className={cx("flex gap-3 rounded-2xl border p-3.5 text-sm", t)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Rounded icon tile used for categories and quick actions. */
export function IconTile({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg", className)}
      style={color ? { background: `color-mix(in oklab, ${color} 16%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  );
}
