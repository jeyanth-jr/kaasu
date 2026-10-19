import { useEffect, useState } from "react";
import { formatINR, parseAmount } from "../domain/money";
import type { Paise } from "../domain/types";
import { Input } from "./components";

/** Rupee input that accepts "1,23,456", "1.5L", "2Cr"; reports paise or null. */
export function MoneyInput({ id, value, onChange, placeholder, allowNegative }: { id?: string; value: Paise | null; onChange: (p: Paise | null) => void; placeholder?: string; allowNegative?: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(value / 100));
  useEffect(() => {
    const parsed = parseAmount(text);
    const cur = parsed === null ? null : Math.round(parsed * 100);
    if (cur !== value) setText(value === null ? "" : String(value / 100));
  }, [value]);
  const parsed = parseAmount(text);
  const showHint = parsed !== null && (/[lLcCkK]/.test(text) || Math.abs(parsed) >= 100_000);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-faint">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className="pl-7 num"
        placeholder={placeholder ?? "0"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseAmount(e.target.value);
          if (n === null) onChange(null);
          else onChange(Math.round((allowNegative ? n : Math.abs(n)) * 100));
        }}
      />
      {showHint && parsed !== null && <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint num">{formatINR(Math.round(parsed * 100))}</span>}
    </div>
  );
}

export function NumberInput({ id, value, onChange, placeholder, step }: { id?: string; value: number | null; onChange: (n: number | null) => void; placeholder?: string; step?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const n = text.trim() === "" ? null : Number(text.replace(/,/g, ""));
    if (n !== value) setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      autoComplete="off"
      className="num"
      step={step}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.replace(/,/g, "").trim();
        if (t === "") return onChange(null);
        const n = Number(t);
        onChange(Number.isFinite(n) ? n : null);
      }}
    />
  );
}

/**
 * The large amount field on the quick-add and payday sheets. Understands "25k", "1.5L" and "2Cr", and
 * always spells the amount out below so an extra or missing zero is obvious before saving.
 */
export function BigMoneyInput({ value, onChange, tone = "plain", autoFocus, label = "Amount in rupees" }: { value: Paise | null; onChange: (p: Paise | null) => void; tone?: "plain" | "hero"; autoFocus?: boolean; label?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value / 100));
  useEffect(() => {
    const parsed = parseAmount(text);
    const cur = parsed === null ? null : Math.round(Math.abs(parsed) * 100);
    if (cur !== value) setText(value === null ? "" : String(value / 100));
  }, [value]);
  const hero = tone === "hero";
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className={hero ? "display text-3xl font-bold opacity-70" : "display text-3xl font-bold text-faint"}>₹</span>
        <input
          autoFocus={autoFocus}
          inputMode="decimal"
          autoComplete="off"
          className={`display w-full min-w-0 bg-transparent text-4xl font-extrabold outline-none num ${hero ? "placeholder:text-white/50" : "text-ink placeholder:text-faint/60"}`}
          placeholder="0"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseAmount(e.target.value);
            onChange(n === null ? null : Math.round(Math.abs(n) * 100));
          }}
          aria-label={label}
        />
      </div>
      {value !== null && value > 0 && <div className={hero ? "mt-1 text-xs font-semibold text-white/80" : "mt-1 text-xs font-semibold text-muted"}>{formatINR(value)}</div>}
    </div>
  );
}
