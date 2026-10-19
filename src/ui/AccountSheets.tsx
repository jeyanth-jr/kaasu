import { useEffect, useMemo, useState } from "react";
import { ACCOUNT_TYPE_LABEL, correctBalance, createAccount, deleteTxnCascade, retireAccount, transferBetween, type AccountType } from "../db/accounts";
import { accountLedger, type LedgerRow } from "../domain/accounts";
import { formatDate, todayISO } from "../domain/dates";
import { formatINR } from "../domain/money";
import type { Instrument } from "../domain/types";
import { AccountPicker, useAccounts } from "./accounts";
import { Badge, Button, Callout, Field, Input, Money, Select, Sheet, cx } from "./components";
import { useData } from "./data";
import { IconArchive, IconArrowIn, IconArrowOut, IconBalance, IconLandmark, IconTransfer, IconTrash } from "./icons";
import { MoneyInput } from "./inputs";

// ---------------------------------------------------------------------------
// Add an account

export function AddAccountSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (a: Instrument) => void }) {
  const { accounts } = useAccounts();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("savings");
  const [balance, setBalance] = useState<number | null>(null);
  const [asOf, setAsOf] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("savings");
    setBalance(null);
    setAsOf(todayISO());
    setError(null);
  }, [open]);

  async function save() {
    if (!name.trim()) return setError("Give the account a name, like “HDFC Savings”.");
    if (accounts.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) return setError("You already have an account with that name.");
    if (balance === null) return setError("Enter today's balance. Use 0 if it's empty.");
    setBusy(true);
    try {
      const a = await createAccount({ name, bank: name, type, opening: balance, asOf });
      onCreated?.(a);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a bank account"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            Add account
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {error && <Callout tone="warn">{error}</Callout>}
        <Field label="Account name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" autoFocus />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Balance as of">{(id) => <Input id={id} type="date" value={asOf} max={todayISO()} onChange={(e) => setAsOf(e.target.value)} />}</Field>
        </div>
        <Field label="Balance right now" hint="Check your banking app. Every entry you log from here moves this balance.">
          {(id) => <MoneyInput id={id} value={balance} onChange={setBalance} />}
        </Field>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Transfer between accounts

export function TransferSheet({ open, onClose, fromId }: { open: boolean; onClose: () => void; fromId?: string }) {
  const { accounts, balances } = useAccounts();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const a = fromId && accounts.some((x) => x.id === fromId) ? fromId : accounts[0]?.id ?? "";
    setFrom(a);
    setTo(accounts.find((x) => x.id !== a)?.id ?? "");
    setAmount(null);
    setDate(todayISO());
    setNote("");
    setError(null);
  }, [open, fromId]);

  async function save() {
    if (!from || !to) return setError("Pick both accounts.");
    if (from === to) return setError("Pick two different accounts.");
    if (!amount) return setError("How much?");
    await transferBetween({ fromId: from, toId: to, amount, date, note });
    onClose();
  }

  if (accounts.length < 2) {
    return (
      <Sheet open={open} onClose={onClose} title="Transfer money">
        <Callout tone="accent" title="You need two accounts">
          Add another bank account first, then move money between them without it counting as spending.
        </Callout>
      </Sheet>
    );
  }
  const short = from && amount !== null && amount > (balances.get(from) ?? 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Transfer money"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            <IconTransfer size={15} /> Move it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {error && <Callout tone="warn">{error}</Callout>}
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">From</div>
          <AccountPicker
            value={from}
            noneLabel={null}
            onChange={(id) => {
              setFrom(id);
              if (id === to) setTo(accounts.find((x) => x.id !== id)?.id ?? "");
            }}
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">To</div>
          <AccountPicker value={to} noneLabel={null} onChange={setTo} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {short && <Callout tone="warn">That's more than the {formatINR(balances.get(from) ?? 0)} Kaasu has for this account. It will go negative until you correct the balance.</Callout>}
        <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />}</Field>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Match the bank's balance

export function BalanceSheet({ open, account, onClose }: { open: boolean; account: Instrument | null; onClose: () => void }) {
  const { balances } = useAccounts();
  const [actual, setActual] = useState<number | null>(null);
  const current = account ? (balances.get(account.id) ?? 0) : 0;
  useEffect(() => {
    if (open) setActual(null);
  }, [open, account?.id]);
  const diff = actual === null ? null : actual - current;
  return (
    <Sheet
      open={open && !!account}
      onClose={onClose}
      title="Match your bank balance"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={actual === null}
            onClick={async () => {
              if (account && actual !== null) await correctBalance(account.id, actual, todayISO());
              onClose();
            }}
          >
            Update balance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-sm text-muted">
          Kaasu has <b className="text-ink">{formatINR(current)}</b> in {account?.name}. Enter what your bank shows and Kaasu records the difference as a correction.
        </p>
        <Field label="Balance in your bank app">{(id) => <MoneyInput id={id} value={actual} onChange={setActual} />}</Field>
        {diff !== null && diff !== 0 && (
          <Callout tone="accent" title={diff > 0 ? `Adds ${formatINR(diff)}` : `Removes ${formatINR(-diff)}`}>
            Likely something not logged yet. You can still log it later; corrections never count as income or spending.
          </Callout>
        )}
        {diff === 0 && <Callout tone="accent">Already matches.</Callout>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// One account: balance, actions and every transaction

export function AccountDetailSheet({ account, onClose, onTransfer }: { account: Instrument | null; onClose: () => void; onTransfer: (id: string) => void }) {
  const { txns, cash, instrumentById } = useData();
  const { balances } = useAccounts();
  const [fix, setFix] = useState(false);
  const [shown, setShown] = useState(40);
  const rows = useMemo(() => (account ? accountLedger(account.id, { txns, cash, instrumentById }) : []), [account, txns, cash, instrumentById]);
  useEffect(() => setShown(40), [account?.id]);
  const balance = account ? (balances.get(account.id) ?? 0) : 0;
  const type = account?.details.kind === "cash" ? ACCOUNT_TYPE_LABEL[account.details.account] : "";

  return (
    <>
      <Sheet open={!!account} onClose={onClose} title={account?.name ?? ""} wide>
        <div className="flex flex-col gap-4 pb-3">
          <div className="bg-hero rounded-3xl p-5">
            <div className="text-xs font-semibold text-white/70">{type} balance</div>
            <Money p={balance} className="display mt-1 block text-4xl font-extrabold" />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="!border-white/25 !bg-white/15 !text-white" onClick={() => account && onTransfer(account.id)}>
                <IconTransfer size={14} /> Transfer
              </Button>
              <Button size="sm" className="!border-white/25 !bg-white/15 !text-white" onClick={() => setFix(true)}>
                <IconBalance size={14} /> Match bank balance
              </Button>
              <Button
                size="sm"
                className="!border-white/25 !bg-white/10 !text-white/90"
                onClick={async () => {
                  if (!account) return;
                  const used = rows.length > 0;
                  if (!confirm(used ? `Archive ${account.name}? Its history stays, and it leaves your balances and account lists.` : `Delete ${account.name}?`)) return;
                  await retireAccount(account.id);
                  onClose();
                }}
              >
                <IconArchive size={14} /> {rows.length > 0 ? "Archive" : "Delete"}
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No transactions yet. Log a spend or income and pick this account.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {rows.slice(0, shown).map((r) => (
                <LedgerLine key={r.txnId} row={r} />
              ))}
            </ul>
          )}
          {rows.length > shown && (
            <Button variant="ghost" onClick={() => setShown(shown + 60)}>
              Show more ({rows.length - shown} older)
            </Button>
          )}
        </div>
      </Sheet>
      <BalanceSheet open={fix} account={account} onClose={() => setFix(false)} />
    </>
  );
}

function LedgerLine({ row }: { row: LedgerRow }) {
  const inbound = row.delta >= 0;
  const removable = row.kind === "transfer" || row.kind === "adjust" || row.kind === "opening" || row.kind === "other" || row.kind === "interest";
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-2xl", inbound ? "bg-gain-soft text-gain" : "bg-sunken text-muted")}>
        {row.kind === "transfer" ? <IconTransfer size={16} /> : row.kind === "opening" ? <IconLandmark size={16} /> : inbound ? <IconArrowIn size={16} /> : <IconArrowOut size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{row.label}</span>
        <span className="block truncate text-xs text-muted">
          {formatDate(row.date, { year: true })}
          {row.sub ? ` · ${row.sub}` : ""}
        </span>
      </span>
      <span className="text-right">
        <Money p={row.delta} sign className={cx("block text-sm font-bold", inbound && "text-gain")} />
        <span className="block text-[11px] text-faint">
          bal <Money p={row.balance} compact />
        </span>
      </span>
      {removable && (
        <button
          onClick={async () => {
            if (confirm(row.kind === "transfer" ? "Delete this transfer from both accounts?" : "Delete this line? The balance will change.")) await deleteTxnCascade(row.txnId);
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint opacity-0 transition hover:bg-loss-soft hover:text-loss focus:opacity-100 group-hover:opacity-100"
          aria-label="Delete"
        >
          <IconTrash size={15} />
        </button>
      )}
    </li>
  );
}

export function AccountKindBadge({ account }: { account: Instrument }) {
  return <Badge>{account.details.kind === "cash" ? ACCOUNT_TYPE_LABEL[account.details.account] : "Account"}</Badge>;
}
