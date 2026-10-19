import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from "react";
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

/** Gain/loss with sign, arrow and colour (never colour alone). */
export function Change({ p, pct, compact, className, hideArrow }: { p: Paise | null; pct?: number | null; compact?: boolean; className?: string; hideArrow?: boolean }) {
  if (p === null) return <span className="text-faint">—</span>;
  const tone = p > 0 ? "text-gain" : p < 0 ? "text-loss" : "text-muted";
  const Arrow = p > 0 ? IconArrowUp : p < 0 ? IconArrowDown : null;
  return (
    <span className={cx("inline-flex items-center gap-0.5 num whitespace-nowrap", tone, className)}>
      {!hideArrow && Arrow && <Arrow size={12} className="shrink-0" />}
      <span className="money">{compact ? formatCompact(p, { sign: true }) : formatINR(p, { sign: true })}</span>
      {pct !== undefined && pct !== null && <span className="opacity-80 text-[0.92em]">({formatPct(pct, { sign: true })})</span>}
    </span>
  );
}

export function PctChange({ pct, className }: { pct: number | null; className?: string }) {
  if (pct === null || !Number.isFinite(pct)) return <span className="text-faint">—</span>;
  const tone = pct > 0.0001 ? "text-gain" : pct < -0.0001 ? "text-loss" : "text-muted";
  return <span className={cx("num whitespace-nowrap", tone, className)}>{formatPct(pct, { sign: true })}</span>;
}

const SOURCE_LABEL: Record<PricePoint["source"], string> = {
  amfi: "AMFI",
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

export function Card({ title, action, children, className, pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5">
          {title && <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>}
          {action}
        </header>
      )}
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display text-3xl font-medium sm:text-4xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold num">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "gain" | "loss"; className?: string }) {
  const tones = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    gain: "bg-accent-soft text-gain",
    loss: "bg-warn-soft text-loss",
  } as const;
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <h3 className="display text-xl">{title}</h3>
      {children && <div className="mt-2 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Meter({ value, max, marks, tone = "accent", label }: { value: number; max: number; marks?: { at: number; label: string }[]; tone?: "accent" | "warn" | "brass"; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tones = { accent: "bg-accent", warn: "bg-warn", brass: "bg-brass" } as const;
  return (
    <div className="relative">
      <div className="h-2.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className={cx("h-full rounded-full transition-[width] duration-500", tones[tone])} style={{ width: `${pct}%` }} />
      </div>
      {marks?.map((m) => (
        <div key={m.label} className="absolute top-0 h-2.5 w-px bg-ink/40" style={{ left: `${Math.min(100, (m.at / max) * 100)}%` }} title={m.label} />
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-xl bg-sunken p-1 text-sm", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 font-medium transition-colors", value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "border border-line bg-surface hover:bg-sunken",
    ghost: "hover:bg-sunken text-muted hover:text-ink",
    danger: "border border-loss/40 text-loss hover:bg-loss/10",
  }[variant];
  const s = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  return <button className={cx("inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:opacity-50 disabled:pointer-events-none", v, s, className)} {...rest} />;
}

export function Field({ label, hint, children, className, error }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; className?: string; error?: string | null }) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <span className="text-xs text-loss">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

const inputCls = "w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";

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
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
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
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,button:not([data-close])")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className={cx("relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:rounded-3xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="display text-xl">{title}</h2>
          <button data-close onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-sunken" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold tracking-wider text-faint uppercase">{children}</h3>;
}

export function Callout({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "warn" | "accent"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = { neutral: "border-line bg-sunken/50", warn: "border-warn/30 bg-warn-soft/60", accent: "border-accent/30 bg-accent-soft/60" }[tone];
  return (
    <div className={cx("flex gap-3 rounded-xl border p-3 text-sm", t)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}
