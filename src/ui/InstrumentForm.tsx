import { addMonths, isValidISO, todayISO } from "../domain/dates";
import { segmentLabel } from "../domain/equity";
import type { AssetClass, EmergencyLayer, EquitySegment, Instrument, InstrumentDetails, InstrumentKind, PayoutFrequency, TaxClass } from "../domain/types";
import { ASSET_CLASSES, EQUITY_SEGMENTS, KIND_LABEL, defaultsForKind } from "../domain/types";
import { Field, Input, Select, Toggle } from "./components";
import { AccountSelect } from "./accounts";
import { MoneyInput, NumberInput } from "./inputs";

export function blankDetails(kind: InstrumentKind): InstrumentDetails {
  const today = todayISO();
  switch (kind) {
    case "stock":
      return { kind, exchange: "NSE", symbol: "" };
    case "etf":
      return { kind, exchange: "NSE", symbol: "" };
    case "mf":
      return { kind, amfiCode: "" };
    case "rd":
      return { kind, bank: "", monthlyAmount: 0, ratePct: 7, start: today, tenureMonths: 12, penaltyPct: 1 };
    case "fd":
      return { kind, bank: "", ratePct: 7, start: today, maturity: addMonths(today, 12), payout: "cumulative", penaltyPct: 1, sweepIn: false };
    case "bond":
      return { kind, issuer: "", faceValue: 1000, couponPct: 9, payout: "quarterly", maturity: addMonths(today, 36), tdsPct: 10, listed: true };
    case "gold":
      return { kind, form: "physical", purity: "24K" };
    case "cash":
      return { kind, bank: "", account: "savings" };
    case "commitment":
      return { kind, beneficiary: "", monthlyAmount: 0, day: 10, start: today };
  }
}

export function blankInstrument(kind: InstrumentKind, name = ""): Instrument {
  return {
    id: "",
    name,
    kind,
    ...defaultsForKind(kind),
    segment: kind === "stock" ? "direct" : undefined,
    details: blankDetails(kind),
    createdAt: "",
  };
}

const TAX_LABEL: Record<TaxClass, string> = {
  equity: "Listed equity / equity fund (STCG 20%, LTCG 12.5% above ₹1.25L)",
  listedOther: "Other listed (gold ETF, listed bonds)",
  unlistedOther: "Unlisted (physical gold, unlisted bonds)",
  slab: "Slab rate (debt funds, interest)",
  none: "Not taxed as capital gains",
};

const PAYOUT: { v: PayoutFrequency; l: string }[] = [
  { v: "cumulative", l: "Cumulative (paid at maturity)" },
  { v: "monthly", l: "Monthly" },
  { v: "quarterly", l: "Quarterly" },
  { v: "halfYearly", l: "Half-yearly" },
  { v: "yearly", l: "Yearly" },
];

export function validateInstrument(i: Instrument): string | null {
  if (!i.name.trim()) return "Give it a name.";
  const d = i.details;
  switch (d.kind) {
    case "mf":
      if (d.amfiCode && !/^\d{3,8}$/.test(d.amfiCode)) return "AMFI scheme codes are numbers (e.g. 122639).";
      if (d.sip && (d.sip.amount <= 0 || d.sip.day < 1 || d.sip.day > 31 || !isValidISO(d.sip.start))) return "Check the SIP amount, day and start date.";
      break;
    case "rd":
      if (d.monthlyAmount <= 0 || d.tenureMonths <= 0 || !isValidISO(d.start)) return "RD needs a monthly amount, start date and tenure.";
      break;
    case "fd":
      if (!isValidISO(d.start) || !isValidISO(d.maturity) || d.maturity <= d.start) return "FD maturity must be after the start date.";
      break;
    case "bond":
      if (!isValidISO(d.maturity) || d.faceValue <= 0) return "Bond needs a face value and maturity date.";
      break;
    case "commitment":
      if (d.monthlyAmount <= 0 || !isValidISO(d.start)) return "Commitment needs a monthly amount and start date.";
      break;
    default:
      break;
  }
  return null;
}

export function InstrumentForm({ value, onChange }: { value: Instrument; onChange: (i: Instrument) => void }) {
  const d = value.details;
  const set = (patch: Partial<Instrument>) => onChange({ ...value, ...patch });
  const setD = (patch: Partial<InstrumentDetails>) => onChange({ ...value, details: { ...d, ...patch } as InstrumentDetails });
  const isEquity = value.assetClass === "equity";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2">
        {(id) => <Input id={id} value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder={placeholderName(value.kind)} />}
      </Field>

      {(d.kind === "stock" || d.kind === "etf" || (d.kind === "gold" && d.form === "etf")) && (
        <>
          <Field label="Symbol" hint="As listed, e.g. INFY, GOLDBEES">
            {(id) => <Input id={id} value={d.symbol ?? ""} onChange={(e) => setD({ symbol: e.target.value.toUpperCase().trim() })} />}
          </Field>
          <Field label="Exchange">
            {(id) => (
              <Select id={id} value={d.exchange ?? "NSE"} onChange={(e) => setD({ exchange: e.target.value as "NSE" | "BSE" })}>
                <option>NSE</option>
                <option>BSE</option>
              </Select>
            )}
          </Field>
        </>
      )}

      {d.kind === "gold" && (
        <Field label="Form">
          {(id) => (
            <Select
              id={id}
              value={d.form}
              onChange={(e) => {
                const form = e.target.value as "etf" | "physical";
                onChange({ ...value, taxClass: form === "etf" ? "listedOther" : "unlistedOther", details: { ...d, form } });
              }}
            >
              <option value="etf">Gold ETF (units)</option>
              <option value="physical">Physical gold (grams)</option>
            </Select>
          )}
        </Field>
      )}

      {d.kind === "mf" && (
        <>
          <Field label="AMFI scheme code" hint="Used to fetch the daily NAV">
            {(id) => <Input id={id} inputMode="numeric" value={d.amfiCode} onChange={(e) => setD({ amfiCode: e.target.value.replace(/\D/g, "") })} />}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={value.assetClass === "equity" ? "equity" : value.taxClass === "slab" ? "debt" : "hybrid"}
                onChange={(e) => {
                  const c = e.target.value;
                  if (c === "equity") set({ assetClass: "equity", taxClass: "equity", details: { ...d, category: "Equity" } });
                  else if (c === "debt") set({ assetClass: "debt", taxClass: "slab", segment: undefined, details: { ...d, category: "Debt" } });
                  else set({ assetClass: "debt", taxClass: "listedOther", segment: undefined, details: { ...d, category: "Hybrid / other" } });
                }}
              >
                <option value="equity">Equity (≥65% equity)</option>
                <option value="debt">Debt / liquid (slab-taxed)</option>
                <option value="hybrid">Hybrid / gold / international FoF</option>
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2 rounded-xl border border-line p-3">
            <Toggle
              checked={!!d.sip}
              onChange={(on) => setD({ sip: on ? { amount: 5000_00, day: 5, start: todayISO() } : undefined })}
              label="Running SIP"
              hint="Adds SIP dates to the calendar and monthly plan"
            />
            {d.sip && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="Amount">{(id) => <MoneyInput id={id} value={d.sip!.amount} onChange={(p) => setD({ sip: { ...d.sip!, amount: p ?? 0 } })} />}</Field>
                <Field label="Day">{(id) => <NumberInput id={id} value={d.sip!.day} onChange={(n) => setD({ sip: { ...d.sip!, day: Math.max(1, Math.min(31, Math.round(n ?? 1))) } })} />}</Field>
                <Field label="Since">{(id) => <Input id={id} type="date" value={d.sip!.start} onChange={(e) => setD({ sip: { ...d.sip!, start: e.target.value } })} />}</Field>
              </div>
            )}
          </div>
        </>
      )}

      {d.kind === "rd" && (
        <>
          <Field label="Bank">{(id) => <Input id={id} value={d.bank} onChange={(e) => setD({ bank: e.target.value })} />}</Field>
          <Field label="Monthly amount">{(id) => <MoneyInput id={id} value={d.monthlyAmount} onChange={(p) => setD({ monthlyAmount: p ?? 0 })} />}</Field>
          <Field label="Interest rate (% p.a.)">{(id) => <NumberInput id={id} value={d.ratePct} onChange={(n) => setD({ ratePct: n ?? 0 })} />}</Field>
          <Field label="Start date">{(id) => <Input id={id} type="date" value={d.start} onChange={(e) => setD({ start: e.target.value })} />}</Field>
          <Field label="Tenure (months)">{(id) => <NumberInput id={id} value={d.tenureMonths} onChange={(n) => setD({ tenureMonths: Math.round(n ?? 0) })} />}</Field>
          <Field label="Premature penalty (% off rate)">{(id) => <NumberInput id={id} value={d.penaltyPct} onChange={(n) => setD({ penaltyPct: n ?? 0 })} />}</Field>
          <AccountSelect
            className="sm:col-span-2"
            label="Debit instalments from, credit maturity to"
            hint="Kaasu records each instalment on its date and the maturity amount when the RD ends. Starts from today."
            value={d.accountId}
            onChange={(id) => setD({ accountId: id, autoFrom: id ? (d.accountId === id && d.autoFrom ? d.autoFrom : todayISO()) : undefined })}
          />
        </>
      )}

      {d.kind === "fd" && (
        <>
          <Field label="Bank">{(id) => <Input id={id} value={d.bank} onChange={(e) => setD({ bank: e.target.value })} />}</Field>
          <Field label="Interest rate (% p.a.)">{(id) => <NumberInput id={id} value={d.ratePct} onChange={(n) => setD({ ratePct: n ?? 0 })} />}</Field>
          <Field label="Start date">{(id) => <Input id={id} type="date" value={d.start} onChange={(e) => setD({ start: e.target.value })} />}</Field>
          <Field label="Maturity date">{(id) => <Input id={id} type="date" value={d.maturity} onChange={(e) => setD({ maturity: e.target.value })} />}</Field>
          <Field label="Interest payout">
            {(id) => (
              <Select id={id} value={d.payout} onChange={(e) => setD({ payout: e.target.value as PayoutFrequency })}>
                {PAYOUT.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Premature penalty (% off rate)">{(id) => <NumberInput id={id} value={d.penaltyPct} onChange={(n) => setD({ penaltyPct: n ?? 0 })} />}</Field>
          <div className="sm:col-span-2">
            <Toggle
              checked={d.sweepIn}
              onChange={(on) => onChange({ ...value, emergencyLayer: on ? "instant" : "second", details: { ...d, sweepIn: on } })}
              label="Sweep-in FD"
              hint="Breaks automatically into your savings account — counts as instant cash"
            />
          </div>
        </>
      )}

      {d.kind === "bond" && (
        <>
          <Field label="Issuer">{(id) => <Input id={id} value={d.issuer} onChange={(e) => setD({ issuer: e.target.value })} />}</Field>
          <Field label="ISIN (optional)">{(id) => <Input id={id} value={d.isin ?? ""} onChange={(e) => setD({ isin: e.target.value.toUpperCase() })} />}</Field>
          <Field label="Face value per unit">{(id) => <NumberInput id={id} value={d.faceValue} onChange={(n) => setD({ faceValue: n ?? 0 })} />}</Field>
          <Field label="Coupon (% p.a.)">{(id) => <NumberInput id={id} value={d.couponPct} onChange={(n) => setD({ couponPct: n ?? 0 })} />}</Field>
          <Field label="Coupon frequency">
            {(id) => (
              <Select id={id} value={d.payout} onChange={(e) => setD({ payout: e.target.value as PayoutFrequency })}>
                {PAYOUT.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Maturity date">{(id) => <Input id={id} type="date" value={d.maturity} onChange={(e) => setD({ maturity: e.target.value })} />}</Field>
          <Field label="Credit rating">{(id) => <Input id={id} value={d.rating ?? ""} placeholder="AAA, AA+ …" onChange={(e) => setD({ rating: e.target.value.toUpperCase() })} />}</Field>
          <Field label="TDS on coupons (%)">{(id) => <NumberInput id={id} value={d.tdsPct} onChange={(n) => setD({ tdsPct: n ?? 0 })} />}</Field>
          <AccountSelect
            className="sm:col-span-2"
            label="Credit coupons and maturity to"
            hint="Kaasu records each coupon (after TDS) and the redemption on their dates, and adds them to this account. Starts from today."
            value={d.payoutAccountId}
            onChange={(id) => setD({ payoutAccountId: id, autoFrom: id ? (d.payoutAccountId === id && d.autoFrom ? d.autoFrom : todayISO()) : undefined })}
          />
          <div className="sm:col-span-2">
            <Toggle checked={d.listed} onChange={(on) => onChange({ ...value, taxClass: on ? "listedOther" : "unlistedOther", details: { ...d, listed: on } })} label="Listed on an exchange" hint="Listed bonds turn long-term after 12 months, unlisted after 24" />
          </div>
        </>
      )}

      {d.kind === "cash" && (
        <>
          <Field label="Bank / wallet">{(id) => <Input id={id} value={d.bank} onChange={(e) => setD({ bank: e.target.value })} />}</Field>
          <Field label="Account type">
            {(id) => (
              <Select id={id} value={d.account} onChange={(e) => setD({ account: e.target.value as "savings" })}>
                <option value="savings">Savings</option>
                <option value="sweep">Sweep-in FD</option>
                <option value="current">Current</option>
                <option value="wallet">Wallet / cash</option>
              </Select>
            )}
          </Field>
        </>
      )}

      {d.kind === "commitment" && (
        <>
          <Field label="For (beneficiary)">{(id) => <Input id={id} value={d.beneficiary} onChange={(e) => setD({ beneficiary: e.target.value })} />}</Field>
          <Field label="Monthly amount">{(id) => <MoneyInput id={id} value={d.monthlyAmount} onChange={(p) => setD({ monthlyAmount: p ?? 0 })} />}</Field>
          <Field label="Day of month">{(id) => <NumberInput id={id} value={d.day} onChange={(n) => setD({ day: Math.max(1, Math.min(31, Math.round(n ?? 1))) })} />}</Field>
          <Field label="Start date">{(id) => <Input id={id} type="date" value={d.start} onChange={(e) => setD({ start: e.target.value })} />}</Field>
          <Field label="End date (optional)">{(id) => <Input id={id} type="date" value={d.end ?? ""} onChange={(e) => setD({ end: e.target.value || undefined })} />}</Field>
        </>
      )}

      <details className="sm:col-span-2 rounded-xl border border-line px-3 py-2 text-sm">
        <summary className="cursor-pointer py-1 font-medium text-muted">Classification</summary>
        <div className="mt-2 grid gap-3 pb-2 sm:grid-cols-2">
          <Field label="Asset class">
            {(id) => (
              <Select id={id} value={value.assetClass} onChange={(e) => set({ assetClass: e.target.value as AssetClass })}>
                {ASSET_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c[0]!.toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tax treatment">
            {(id) => (
              <Select id={id} value={value.taxClass} onChange={(e) => set({ taxClass: e.target.value as TaxClass })}>
                {(Object.keys(TAX_LABEL) as TaxClass[]).map((t) => (
                  <option key={t} value={t}>
                    {TAX_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {isEquity && (
            <Field label="Segment">
              {(id) => (
                <Select id={id} value={value.segment ?? "other"} onChange={(e) => set({ segment: e.target.value as EquitySegment })}>
                  {EQUITY_SEGMENTS.map((s) => (
                    <option key={s} value={s}>
                      {segmentLabel(s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {(isEquity || value.kind === "stock") && (
            <Field label="Sector" hint={value.kind === "stock" ? "Used for concentration checks" : "Leave empty for diversified funds"}>
              {(id) => <Input id={id} value={value.sector ?? ""} onChange={(e) => set({ sector: e.target.value || undefined })} />}
            </Field>
          )}
          {(value.kind === "mf" || value.kind === "etf") && (
            <Field label="Tracks index" hint="e.g. NIFTY 50 — flags duplicate products">
              {(id) => <Input id={id} value={value.trackingIndex ?? ""} onChange={(e) => set({ trackingIndex: e.target.value.toUpperCase() || undefined })} />}
            </Field>
          )}
          <Field label="Emergency fund">
            {(id) => (
              <Select id={id} value={value.emergencyLayer} onChange={(e) => set({ emergencyLayer: e.target.value as EmergencyLayer })}>
                <option value="instant">Instant cash (layer 1)</option>
                <option value="second">Slower to access (layer 2)</option>
                <option value="none">Not part of emergency fund</option>
              </Select>
            )}
          </Field>
        </div>
      </details>
    </div>
  );
}

function placeholderName(kind: InstrumentKind): string {
  return {
    stock: "e.g. Infosys",
    etf: "e.g. Nippon India ETF Nifty BeES",
    mf: "e.g. Parag Parikh Flexi Cap – Direct Growth",
    rd: "e.g. SBI RD",
    fd: "e.g. HDFC Bank FD",
    bond: "e.g. Muthoot Finance NCD 2027",
    gold: "e.g. Gold coins",
    cash: "e.g. HDFC Savings",
    commitment: "e.g. Jewellery savings plan",
  }[kind];
}

export { KIND_LABEL };
