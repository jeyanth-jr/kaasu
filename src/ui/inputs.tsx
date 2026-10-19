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
  const showHint = parsed !== null && /[lLcCkK]/.test(text);
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
