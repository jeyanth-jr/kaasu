import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { db, newId, nowISO } from "../db/db";
import { addMonths, formatDate, isValidISO, monthKey, monthStart, todayISO, withDay } from "../domain/dates";
import { formatINR } from "../domain/money";
import { LOAN_KIND_LABEL, amortize, emiFor, firstEmiDate, lastInstalmentDate, monthsFor } from "../domain/obligations";
import type { Instrument, Liability, LoanKind } from "../domain/types";
import { defaultsForKind } from "../domain/types";
import { Button, Callout, Field, Input, Select, Sheet, Toggle, cx } from "./components";
import { useData } from "./data";
import { IconGem, IconLandmark, IconPiggy, IconTrendUp } from "./icons";
import { AccountSelect } from "./accounts";
import { MoneyInput, NumberInput } from "./inputs";
import { KIND_STYLE, LOAN_ICON } from "./planStyle";

type PlanType = "sip" | "rd" | "chit" | "loan";

const TILES: { type: PlanType; title: string; sub: string; icon: typeof IconTrendUp; color: string }[] = [
  { type: "sip", title: "SIP", sub: "Monthly mutual fund investment", icon: IconTrendUp, color: KIND_STYLE.sip.color },
  { type: "rd", title: "Recurring deposit", sub: "Fixed monthly bank deposit", icon: IconPiggy, color: KIND_STYLE.rd.color },
  { type: "chit", title: "Gold chit", sub: "Jeweller savings scheme", icon: IconGem, color: KIND_STYLE.chit.color },
  { type: "loan", title: "Loan / EMI", sub: "Track debt and payoff", icon: IconLandmark, color: KIND_STYLE.emi.color },
];

export function NewPlanSheet({ open, onClose, start }: { open: boolean; onClose: () => void; start?: PlanType }) {
  const [type, setType] = useState<PlanType | null>(start ?? null);
  const close = () => {
    setType(null);
    onClose();
  };
  if (type === "loan") return <LoanSheet open={open} onClose={close} />;
  return (
    <Sheet open={open} onClose={close} title={type ? TILES.find((t) => t.type === type)!.title : "New monthly plan"}>
      {!type ? (
        <div className="grid grid-cols-2 gap-3 pb-2">
          {TILES.map((t, i) => (
            <motion.button
              key={t.type}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setType(t.type)}
              className="flex flex-col items-start gap-5 rounded-3xl border border-line p-4 text-left hover:border-accent/40"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: `color-mix(in oklab, ${t.color} 16%, transparent)`, color: t.color }}>
                <t.icon size={22} />
              </span>
              <span>
                <span className="block text-base font-bold">{t.title}</span>
                <span className="block text-xs text-muted">{t.sub}</span>
              </span>
            </motion.button>
          ))}
        </div>
      ) : type === "sip" ? (
        <SipForm onDone={close} onBack={() => setType(null)} />
      ) : type === "rd" ? (
        <RdForm onDone={close} onBack={() => setType(null)} />
      ) : (
        <ChitForm onDone={close} onBack={() => setType(null)} />
      )}
    </Sheet>
  );
}

function FormFooter({ onBack, onSave, disabled, label = "Save plan", error }: { onBack: () => void; onSave: () => void; disabled?: boolean; label?: string; error?: string | null }) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      {error && <Callout tone="warn">{error}</Callout>}
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onSave} disabled={disabled}>
          {label}
        </Button>
      </div>
    </div>
  );
}

function Duration({ months, setMonths, hint }: { months: number | null; setMonths: (n: number | null) => void; hint: string }) {
  return (
    <Field label="Duration (months)" hint={hint}>
      {(id) => <NumberInput id={id} value={months} onChange={(n) => setMonths(n === null ? null : Math.max(1, Math.round(n)))} placeholder="Open-ended" />}
    </Field>
  );
}

// ---------------------------------------------------------------------------

function SipForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { instruments } = useData();
  const funds = instruments.filter((i) => i.kind === "mf" && !i.archived);
  const [fundId, setFundId] = useState(funds[0]?.id ?? "new");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(5);
  const [start, setStart] = useState(todayISO());
  const [months, setMonths] = useState<number | null>(null);
  const [sipAccount, setSipAccount] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const existing = funds.find((f) => f.id === fundId);
  const hasSip = existing?.details.kind === "mf" && !!existing.details.sip;

  async function save() {
    if (!amount || !day || !isValidISO(start)) return setError("Fill in the amount, day and start date.");
    if (fundId === "new" && !name.trim()) return setError("Name the fund.");
    const sip = { amount, day: Math.max(1, Math.min(31, day)), start, end: months ? lastInstalmentDate(start, day, months) : undefined, accountId: sipAccount };
    if (existing && existing.details.kind === "mf") {
      await db.instruments.put({ ...existing, details: { ...existing.details, sip } });
    } else {
      const inst: Instrument = { id: newId("i_"), name: name.trim(), kind: "mf", ...defaultsForKind("mf"), segment: "other", details: { kind: "mf", amfiCode: code.replace(/\D/g, ""), sip }, createdAt: nowISO() };
      await db.instruments.add(inst);
    }
    onDone();
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Fund" className="sm:col-span-2">
        {(id) => (
          <Select id={id} value={fundId} onChange={(e) => setFundId(e.target.value)}>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="new">New fund…</option>
          </Select>
        )}
      </Field>
      {fundId === "new" && (
        <>
          <Field label="Fund name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Parag Parikh Flexi Cap – Direct" />}</Field>
          <Field label="AMFI code (optional)" hint="Link prices later from Holdings">
            {(id) => <Input id={id} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
        </>
      )}
      <Field label="Monthly amount">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
      <Field label="Debited on day">{(id) => <NumberInput id={id} value={day} onChange={(n) => setDay(n === null ? null : Math.round(n))} />}</Field>
      <Field label="First instalment from">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
      <Duration months={months} setMonths={setMonths} hint="Leave empty for a SIP that runs until you stop it" />
      <AccountSelect className="sm:col-span-2" label="Debited from" hint={'After each due date Kaasu asks "have you paid?", then records the units at the NAV you give and takes the amount from this account.'} value={sipAccount} onChange={setSipAccount} />
      {hasSip && <p className="text-xs text-warn sm:col-span-2">This fund already has a SIP. Saving replaces it.</p>}
      <div className="sm:col-span-2">
        <FormFooter onBack={onBack} onSave={() => void save()} error={error} />
      </div>
    </div>
  );
}

function RdForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [rate, setRate] = useState<number | null>(6.8);
  const [start, setStart] = useState(todayISO());
  const [months, setMonths] = useState<number | null>(12);
  const [penalty, setPenalty] = useState<number | null>(1);
  const [rdAccount, setRdAccount] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!bank.trim() || !amount || !months || !isValidISO(start)) return setError("Fill in the bank, amount, start date and duration.");
    const inst: Instrument = {
      id: newId("i_"),
      name: `${bank.trim()} RD`,
      kind: "rd",
      ...defaultsForKind("rd"),
      details: { kind: "rd", bank: bank.trim(), monthlyAmount: amount, ratePct: rate ?? 0, start, tenureMonths: months, penaltyPct: penalty ?? 0, accountId: rdAccount, autoFrom: rdAccount ? (start > todayISO() ? start : todayISO()) : undefined },
      createdAt: nowISO(),
    };
    await db.instruments.add(inst);
    onDone();
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Bank">{(id) => <Input id={id} value={bank} onChange={(e) => setBank(e.target.value)} placeholder="SBI" />}</Field>
      <Field label="Monthly deposit">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
      <Field label="Interest rate (% p.a.)">{(id) => <NumberInput id={id} value={rate} onChange={setRate} />}</Field>
      <Field label="Premature penalty (% off rate)">{(id) => <NumberInput id={id} value={penalty} onChange={setPenalty} />}</Field>
      <Field label="Started on">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
      <Duration months={months} setMonths={setMonths} hint="Tenure of the RD" />
      <AccountSelect className="sm:col-span-2" label="Debit instalments from, credit maturity to" hint="Kaasu records each instalment on its date and the maturity amount when the RD ends, from today on." value={rdAccount} onChange={setRdAccount} />
      <div className="sm:col-span-2">
        <FormFooter onBack={onBack} onSave={() => void save()} error={error} />
      </div>
    </div>
  );
}

function ChitForm({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState("Gold savings scheme");
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(10);
  const [start, setStart] = useState(todayISO());
  const [months, setMonths] = useState<number | null>(11);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !amount || !day || !months || !isValidISO(start)) return setError("Fill in the name, amount, day, start date and duration.");
    const inst: Instrument = {
      id: newId("i_"),
      name: name.trim(),
      kind: "commitment",
      ...defaultsForKind("commitment"),
      assetClass: "gold", // counted as gold, but outside net worth unless you switch commitments on
      details: { kind: "commitment", beneficiary: who.trim(), monthlyAmount: amount, day: Math.max(1, Math.min(31, day)), start, end: lastInstalmentDate(start, day, months) },
      createdAt: nowISO(),
    };
    await db.instruments.add(inst);
    onDone();
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Scheme / jeweller">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="For (optional)">{(id) => <Input id={id} value={who} onChange={(e) => setWho(e.target.value)} placeholder="Amma" />}</Field>
      <Field label="Monthly amount">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
      <Field label="Paid on day">{(id) => <NumberInput id={id} value={day} onChange={(n) => setDay(n === null ? null : Math.round(n))} />}</Field>
      <Field label="First instalment from">{(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
      <Duration months={months} setMonths={setMonths} hint="Number of monthly payments you make (many schemes: 11)" />
      <p className="text-xs text-muted sm:col-span-2">Chits sit outside your net worth by default, since the money is committed to a purchase. Change that under Allocation.</p>
      <div className="sm:col-span-2">
        <FormFooter onBack={onBack} onSave={() => void save()} error={error} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loans

const LOAN_KINDS = Object.keys(LOAN_KIND_LABEL) as LoanKind[];

export function LoanSheet({ open, onClose, loan }: { open: boolean; onClose: () => void; loan?: Liability }) {
  const [name, setName] = useState(loan?.name ?? "");
  const [kind, setKind] = useState<LoanKind>(loan?.kind ?? "personal");
  const [simple, setSimple] = useState(!!loan && !loan.principal);
  const [principal, setPrincipal] = useState<number | null>(loan?.principal ?? null);
  const [rate, setRate] = useState<number | null>(loan?.ratePct ?? 10);
  const [tenure, setTenure] = useState<number | null>(loan?.tenureMonths ?? 36);
  const [emiInput, setEmiInput] = useState<number | null>(loan?.emi ?? null);
  const [emiTouched, setEmiTouched] = useState(!!loan);
  const [start, setStart] = useState(loan?.startDate ?? todayISO());
  const [day, setDay] = useState<number | null>(loan?.emiDay ?? 5);
  const [endDate, setEndDate] = useState(loan?.endDate ?? addMonths(todayISO(), 12));
  const [error, setError] = useState<string | null>(null);

  const suggested = principal && tenure ? emiFor(principal, rate ?? 0, tenure) : null;
  const emi = simple ? emiInput : emiTouched ? emiInput : suggested;
  const preview = useMemo(() => {
    if (simple || !principal || !emi || !day || !isValidISO(start)) return null;
    const a = amortize({ balance: principal, annualPct: rate ?? 0, emi, firstDate: firstEmiDate(start, day), emiDay: day });
    return { ...a, last: a.rows.at(-1)?.date ?? null };
  }, [simple, principal, emi, day, start, rate]);

  async function save() {
    if (!name.trim() || !emi || !day) return setError("Give the loan a name, an EMI and an EMI day.");
    let end = endDate;
    let tenureMonths: number | undefined;
    if (!simple) {
      if (!principal || !isValidISO(start)) return setError("Enter the amount borrowed and the start date.");
      const months = monthsFor(principal, rate ?? 0, emi);
      if (!months) return setError("That EMI doesn't even cover the monthly interest, so the loan would never be paid off.");
      tenureMonths = months;
      end = withDay(addMonths(monthStart(monthKey(firstEmiDate(start, day))), months - 1), day);
    } else if (!isValidISO(endDate)) return setError("Enter the date of the last EMI.");
    const l: Liability = {
      id: loan?.id ?? newId("l_"),
      name: name.trim(),
      kind,
      emi,
      emiDay: Math.max(1, Math.min(31, day)),
      endDate: end,
      principal: simple ? undefined : principal!,
      ratePct: simple ? undefined : (rate ?? 0),
      startDate: simple ? loan?.startDate : start,
      tenureMonths,
    };
    await db.liabilities.put(l);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={loan ? "Edit loan" : "New loan / EMI"}
      footer={
        <>
          {loan && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (confirm(`Delete ${loan.name}? This only removes the tracking, not the loan.`)) {
                  await db.liabilities.delete(loan.id);
                  onClose();
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()}>
            Save loan
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC car loan" />}</Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as LoanKind)}>
              {LOAN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LOAN_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2 rounded-2xl border border-line px-3">
          <Toggle checked={simple} onChange={setSimple} label="I only know the EMI" hint="Skips balance and interest maths; still shows EMIs left and the end date" />
        </div>
        {!simple && (
          <>
            <Field label="Amount borrowed">{(id) => <MoneyInput id={id} value={principal} onChange={setPrincipal} />}</Field>
            <Field label="Interest rate (% p.a.)" hint="0 for a no-cost EMI">
              {(id) => <NumberInput id={id} value={rate} onChange={setRate} />}
            </Field>
            <Field label="Tenure (months)">{(id) => <NumberInput id={id} value={tenure} onChange={(n) => setTenure(n === null ? null : Math.round(n))} />}</Field>
            <Field label="Loan started on" hint="First EMI is a month later">
              {(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
          </>
        )}
        <Field label="EMI" hint={!simple && suggested && !emiTouched ? "Worked out from amount, rate and tenure. Edit it to match your statement." : undefined}>
          {(id) => (
            <MoneyInput
              id={id}
              value={emi}
              onChange={(p) => {
                setEmiInput(p);
                setEmiTouched(true);
              }}
            />
          )}
        </Field>
        <Field label="EMI day of month">{(id) => <NumberInput id={id} value={day} onChange={(n) => setDay(n === null ? null : Math.round(n))} />}</Field>
        {simple && <Field label="Last EMI date">{(id) => <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>}
      </div>
      {preview && (
        <div className={cx("mt-4 flex items-center gap-3 rounded-2xl p-3 text-sm", preview.paysOff ? "bg-accent-soft/60" : "bg-warn-soft")}>
          {(() => {
            const Icon = LOAN_ICON[kind];
            return <Icon size={20} className="shrink-0 text-accent" />;
          })()}
          {preview.paysOff ? (
            <span>
              {preview.rows.length} EMIs of <b className="money">{formatINR(emi ?? 0)}</b>, last one {preview.last && formatDate(preview.last)}. Total interest <b className="money">{formatINR(preview.totalInterest)}</b>.
            </span>
          ) : (
            <span>This EMI doesn't cover the monthly interest, so the balance would never fall.</span>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Callout tone="warn">{error}</Callout>
        </div>
      )}
    </Sheet>
  );
}
