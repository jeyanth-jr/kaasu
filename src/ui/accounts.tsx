import { useMemo } from "react";
import { activeAccounts } from "../domain/accounts";
import type { Instrument, Paise } from "../domain/types";
import { cx, Money } from "./components";
import { useData } from "./data";
import { IconLandmark } from "./icons";

/** Open bank accounts with their current balances. */
export function useAccounts(): { accounts: Instrument[]; balances: Map<string, Paise>; total: Paise } {
  const { instruments, portfolio } = useData();
  return useMemo(() => {
    const accounts = activeAccounts(instruments);
    const balances = new Map(portfolio.holdings.filter((h) => h.instrument.kind === "cash").map((h) => [h.instrument.id, h.value]));
    return { accounts, balances, total: accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0) };
  }, [instruments, portfolio]);
}

/** The account to preselect: the one used last, else the salary account, else the only account. */
export function defaultAccountId(accounts: Instrument[], ...preferred: (string | undefined)[]): string {
  for (const p of preferred) if (p && accounts.some((a) => a.id === p)) return p;
  return accounts.length === 1 ? accounts[0]!.id : "";
}

/** Tap-to-choose account chips with balances. Renders nothing until an account exists. */
export function AccountPicker({ value, onChange, noneLabel = "Not tracked", showBalance = true }: { value: string; onChange: (id: string) => void; noneLabel?: string | null; showBalance?: boolean }) {
  const { accounts, balances } = useAccounts();
  if (accounts.length === 0) return null;
  return (
    <div role="radiogroup" aria-label="Account" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {accounts.map((a) => (
        <Chip key={a.id} active={value === a.id} label={a.name} onClick={() => onChange(a.id)}>
          <IconLandmark size={14} className="shrink-0" />
          <span className="min-w-0 text-left">
            <span className="block max-w-[10rem] truncate">{a.name}</span>
            {showBalance && (
              <span className="block text-[11px] font-medium opacity-70">
                <Money p={balances.get(a.id) ?? 0} compact />
              </span>
            )}
          </span>
        </Chip>
      ))}
      {noneLabel && (
        <Chip active={value === ""} onClick={() => onChange("")}>
          {noneLabel}
        </Chip>
      )}
    </div>
  );
}

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={label}
      aria-checked={active}
      onClick={onClick}
      className={cx(
        "flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.97]",
        active ? "border-accent/60 bg-accent-soft text-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.4)]" : "border-line bg-sunken/40 text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Small account label for list rows. */
export function AccountTag({ id }: { id: string | undefined }) {
  const { instrumentById } = useData();
  const a = id ? instrumentById.get(id) : undefined;
  if (!a) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-muted">
      <IconLandmark size={11} />
      {a.name}
    </span>
  );
}
