import confetti from "canvas-confetti";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { confirmSalary, deleteEntry, importStatement, saveEntry, setChecklistItem } from "../db/cash";
import { CATEGORIES, categoryOf, guessStatementMapping, parseStatement, type CashEntry, type EntryKind, type StatementMapping, type StatementRow } from "../domain/cashflow";
import { parseCsvText } from "../domain/csv";
import { formatDate, monthKey, todayISO } from "../domain/dates";
import { formatINR } from "../domain/money";
import { CategoryIcon, CommitmentIcon } from "./categoryIcons";
import { Badge, Button, Callout, Field, Input, Select, Sheet, Toggle, cx } from "./components";
import { useData } from "./data";
import { IconCheck, IconParty } from "./icons";
import { useCommitments } from "./money";

function useCashAccounts() {
  const { instruments } = useData();
  return instruments.filter((i) => i.kind === "cash" && !i.archived);
}

// ---------------------------------------------------------------------------
// Quick add: spent / got money

export function EntrySheet({ open, onClose, kind: initialKind = "expense", entry }: { open: boolean; onClose: () => void; kind?: EntryKind; entry?: CashEntry }) {
  const accounts = useCashAccounts();
  const { settings } = useData();
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? initialKind);
  const [amount, setAmount] = useState<number | null>(entry?.amount ?? null);
  const [category, setCategory] = useState(entry?.category ?? (initialKind === "income" ? "salary" : "food"));
  const [date, setDate] = useState(entry?.date ?? todayISO());
  const [note, setNote] = useState(entry?.note ?? "");
  const [accountId, setAccountId] = useState(entry?.accountId ?? settings.salary?.accountId ?? "");
  const [post, setPost] = useState(entry ? !!entry.linkedTxnId : false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? initialKind);
    setAmount(entry?.amount ?? null);
    setCategory(entry?.category ?? (initialKind === "income" ? "salary" : "food"));
    setDate(entry?.date ?? todayISO());
    setNote(entry?.note ?? "");
    setAccountId(entry?.accountId ?? settings.salary?.accountId ?? "");
    setPost(entry ? !!entry.linkedTxnId : false);
    setError(null);
  }, [open, entry, initialKind]);

  const cats = CATEGORIES.filter((c) => c.kind === kind);

  async function save() {
    if (!amount || amount <= 0) return setError("How much?");
    if (date > todayISO()) return setError("That's in the future: add it when it happens.");
    await saveEntry({ date, kind, amount, category, note, accountId: accountId || undefined, postToAccount: post }, entry);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={entry ? "Edit entry" : kind === "expense" ? "Spent money" : "Got money"}
      footer={
        <>
          {entry && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (confirm("Delete this entry?")) {
                  await deleteEntry(entry);
                  onClose();
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="primary" onClick={save}>
            {entry ? "Save" : kind === "expense" ? "Log spend" : "Log income"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!entry && (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-sunken p-1 text-sm font-semibold">
            {(["expense", "income"] as EntryKind[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setCategory(k === "income" ? "salary" : "food");
                }}
                className={cx("rounded-full py-2 transition", kind === k ? (k === "expense" ? "bg-loss text-white" : "bg-gain text-white") : "text-muted")}
              >
                {k === "expense" ? "Spent" : "Received"}
              </button>
            ))}
          </div>
        )}
        <div className="rounded-3xl bg-sunken/70 px-4 py-3">
          <div className="text-xs font-semibold text-muted">Amount</div>
          <BigAmount value={amount} onChange={setAmount} />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick amounts">
            {[100, 200, 500, 1000, 5000].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount((amount ?? 0) + n * 100)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold transition active:scale-95 hover:border-accent hover:text-accent"
              >
                +{n >= 1000 ? `${n / 1000}K` : n}
              </button>
            ))}
            {amount !== null && (
              <button type="button" onClick={() => setAmount(null)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-faint hover:text-loss">
                Clear
              </button>
            )}
          </div>
        </div>
        {error && <Callout tone="warn">{error}</Callout>}
        <div>
          <div className="mb-2 text-xs font-semibold text-muted">Category</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {cats.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cx("flex flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-[11px] font-semibold transition", category === c.id ? "border-transparent text-ink ring-2" : "border-line text-muted hover:border-accent/40")}
                style={category === c.id ? { background: `color-mix(in oklab, ${c.color} 18%, transparent)`, ["--tw-ring-color" as string]: c.color } : undefined}
              >
                <CategoryIcon id={c.id} size={20} />
                <span className="line-clamp-1 w-full text-center">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="When">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "expense" ? "Swiggy, Uber…" : "Optional"} />}</Field>
        </div>
        {accounts.length > 0 && (
          <div className="rounded-2xl border border-line px-3 py-1">
            <Field label="Account">
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1">
                  <option value="">Not tracked</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {accountId && <Toggle checked={post} onChange={setPost} label="Update this account's balance" hint={kind === "expense" ? "Records a withdrawal in Holdings" : "Records a deposit in Holdings"} />}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function BigAmount({ value, onChange }: { value: number | null; onChange: (p: number | null) => void }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="display text-3xl font-bold text-faint">₹</span>
      <input
        autoFocus
        inputMode="decimal"
        className="display w-full bg-transparent text-4xl font-extrabold text-ink outline-none placeholder:text-faint/60 num"
        placeholder="0"
        value={value === null ? "" : String(value / 100)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          onChange(t === "" ? null : Math.round(Number(t) * 100));
        }}
        aria-label="Amount in rupees"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payday

export function PaydaySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, paydays, cash } = useData();
  const accounts = useCashAccounts();
  const month = monthKey(todayISO());
  const record = paydays.find((p) => p.month === month);
  // Any salary credit this month counts (payday flow, manual entry or statement import).
  const received =
    cash.find((e) => e.id === record?.salaryEntryId) ?? cash.find((e) => e.kind === "income" && e.category === "salary" && monthKey(e.date) === month);
  const [step, setStep] = useState<"confirm" | "plan">(received ? "plan" : "confirm");
  const [amount, setAmount] = useState<number | null>(settings.salary?.amount ?? null);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState(settings.salary?.accountId ?? "");
  const [post, setPost] = useState(true);
  const salary = received?.amount ?? amount ?? 0;
  const items = useCommitments(month, salary);
  const done = record?.done ?? {};
  const committed = items.reduce((s, i) => s + i.amount, 0);
  const doneCount = items.filter((i) => done[i.id]).length;

  useEffect(() => {
    if (open) {
      setStep(received ? "plan" : "confirm");
      setAmount(settings.salary?.amount ?? null);
      setAccountId(settings.salary?.accountId ?? "");
    }
  }, [open]);

  async function confirm() {
    if (!amount) return;
    await confirmSalary({ date, amount, accountId: accountId || undefined, postToAccount: post && !!accountId, employer: settings.salary?.employer });
    burst();
    setStep("plan");
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step === "confirm" ? "Payday!" : "Make it work"}
      footer={
        step === "confirm" ? (
          <Button variant="primary" size="lg" onClick={confirm} disabled={!amount}>
            <IconParty size={18} /> Yes, salary's in
          </Button>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {step === "confirm" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Confirm what actually landed. Kaasu then lines up where it goes before you spend a rupee.</p>
          <div className="rounded-3xl bg-hero px-5 py-4">
            <div className="text-xs font-semibold text-white/80">In-hand salary</div>
            <div className="flex items-baseline gap-1 text-white">
              <span className="display text-3xl font-bold opacity-70">₹</span>
              <input
                inputMode="decimal"
                className="display w-full bg-transparent text-4xl font-extrabold outline-none placeholder:text-white/50 num"
                value={amount === null ? "" : String(amount / 100)}
                onChange={(e) => {
                  const t = e.target.value.replace(/[^\d.]/g, "");
                  setAmount(t === "" ? null : Math.round(Number(t) * 100));
                }}
                aria-label="Salary amount"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credited on">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Into">
              {(id) => (
                <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Not tracked</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {accountId && <Toggle checked={post} onChange={setPost} label="Add it to that account's balance" />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Salary" value={formatINR(salary)} />
            <MiniStat label="Committed" value={formatINR(committed)} />
            <MiniStat label="Free to spend" value={formatINR(salary - committed)} tone={salary - committed >= 0 ? "gain" : "loss"} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
              <span>Payday checklist</span>
              <span>
                {doneCount}/{items.length} done
              </span>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-muted">No SIPs, RDs, commitments or EMIs planned yet. Add them under Calendar → Monthly plan.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((i) => (
                  <li key={i.id}>
                    <button
                      onClick={() => {
                        void setChecklistItem(month, i.id, !done[i.id]);
                        if (!done[i.id] && doneCount + 1 === items.length) burst();
                      }}
                      className={cx("flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition", done[i.id] ? "border-gain/30 bg-gain-soft" : "border-line hover:border-accent/40")}
                    >
                      <CommitmentIcon kind={i.kind} size={20} />
                      <span className={cx("min-w-0 flex-1 text-sm font-semibold", done[i.id] && "text-muted line-through")}>{i.label}</span>
                      <span className="text-sm font-bold num">{formatINR(i.amount)}</span>
                      <span className={cx("grid h-6 w-6 place-items-center rounded-full border-2", done[i.id] ? "border-gain bg-gain text-white" : "border-line")}>
                        {done[i.id] && <IconCheck size={14} strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-faint">Ticking an item is a reminder, not a transaction. SIPs show up in Holdings once units are allotted and you record them.</p>
        </div>
      )}
    </Sheet>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-2xl bg-sunken px-2 py-2.5">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className={cx("money mt-0.5 text-sm font-extrabold num", tone === "gain" && "text-gain", tone === "loss" && "text-loss")}>{value}</div>
    </div>
  );
}

export function burst() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#6a46ff", "#d946ef", "#c4f135", "#10b981", "#f5b301"];
  void confetti({ particleCount: 110, spread: 75, origin: { y: 0.7 }, colors, disableForReducedMotion: true });
}

// ---------------------------------------------------------------------------
// Bank statement import

export function StatementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useCashAccounts();
  const { cash } = useData();
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [rows, setRows] = useState<(StatementRow & { include: boolean })[]>([]);
  const [accountId, setAccountId] = useState("");
  const [post, setPost] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => new Set(cash.map((c) => c.fingerprint).filter(Boolean)), [cash]);

  useEffect(() => {
    if (!open) {
      setGrid(null);
      setRows([]);
      setMsg(null);
    }
  }, [open]);

  async function onFile(f: File) {
    setFileName(f.name);
    setMsg(null);
    const g = parseCsvText(await f.text());
    setGrid(g);
    const m = guessStatementMapping(g);
    setMapping(m);
    if (!m) {
      setRows([]);
      setMsg("Couldn't find Date / Narration / Debit / Credit columns. Export the statement as CSV (not PDF) from net banking and try again.");
      return;
    }
    setRows(parseStatement(g, m).rows.map((r) => ({ ...r, include: true })));
  }

  const fresh = rows.filter((r) => !known.has(r.fingerprint));
  const spent = fresh.filter((r) => r.include && r.kind === "expense").reduce((s, r) => s + r.amount, 0);
  const got = fresh.filter((r) => r.include && r.kind === "income").reduce((s, r) => s + r.amount, 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Import bank statement"
      footer={
        rows.length > 0 ? (
          <Button
            variant="primary"
            disabled={busy || fresh.filter((r) => r.include).length === 0}
            onClick={async () => {
              setBusy(true);
              const r = await importStatement(rows, { accountId: accountId || undefined, postToAccount: post && !!accountId, fileName });
              setBusy(false);
              burst();
              setMsg(`Added ${r.added} entries${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}.`);
              setRows([]);
              setGrid(null);
            }}
          >
            Import {fresh.filter((r) => r.include).length} entries
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Download your statement as CSV from net banking (HDFC, ICICI, SBI, Axis, Kotak and most others work). Kaasu sorts each line into a category, and re-importing the same statement won't double-count.</p>
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
          Choose statement CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        {msg && <Callout tone={msg.startsWith("Added") ? "accent" : "warn"}>{msg}</Callout>}
        {grid && mapping && rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="accent">{fresh.length} new</Badge>
              {rows.length - fresh.length > 0 && <Badge>{rows.length - fresh.length} already imported</Badge>}
              <span className="text-muted">
                out <b className="money text-ink">{formatINR(spent)}</b> · in <b className="money text-gain">{formatINR(got)}</b>
              </span>
            </div>
            {accounts.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Which account is this?">
                  {(id) => (
                    <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">Don't link</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {accountId && <Toggle checked={post} onChange={setPost} label="Also update its balance" hint="Leave off if you track that balance another way" />}
              </div>
            )}
            <div className="max-h-[45vh] overflow-auto rounded-2xl border border-line">
              <ul>
                {rows.map((r, idx) => {
                  const dup = known.has(r.fingerprint);
                  const cat = categoryOf(r.category);
                  return (
                    <li key={idx} className={cx("flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0", (dup || !r.include) && "opacity-50")}>
                      <input
                        type="checkbox"
                        checked={r.include && !dup}
                        disabled={dup}
                        onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, include: e.target.checked } : x)))}
                        aria-label="Include"
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="w-14 shrink-0 text-xs text-muted num">{formatDate(r.date, { year: false })}</span>
                      <span className="min-w-0 flex-1 truncate" title={r.description}>
                        {r.description}
                      </span>
                      <select
                        value={r.category}
                        onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}
                        className="w-32 shrink-0 rounded-xl border border-line bg-paper px-1.5 py-1 text-xs"
                        aria-label="Category"
                      >
                        {CATEGORIES.filter((c) => c.kind === r.kind).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <span className={cx("money w-24 shrink-0 text-right font-semibold num", r.kind === "income" && "text-gain")}>
                        {r.kind === "income" ? "+" : "−"}
                        {formatINR(r.amount)}
                      </span>
                      {dup && <Badge>dup</Badge>}
                      <span className="sr-only">{cat.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-faint">
          PDF statements vary too much between banks to read reliably; use the CSV/Excel export (save Excel as CSV).
        </motion.p>
      </div>
    </Sheet>
  );
}
