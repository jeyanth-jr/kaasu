import { useEffect, useMemo, useState } from "react";
import { recordSipPaid, skipSip } from "../db/autopost";
import { sipsDue, unitsFor, type SipDue } from "../domain/autopost";
import { formatDate, todayISO } from "../domain/dates";
import { formatINR } from "../domain/money";
import { AccountPicker, defaultAccountId, useAccounts } from "./accounts";
import { Button, Callout, Card, Field, Input, Money, Sheet } from "./components";
import { useData } from "./data";
import { IconTrendUp } from "./icons";
import { MoneyInput, NumberInput } from "./inputs";

/** "Have you paid your SIP?": one row per SIP instalment that is due and not yet recorded. */
export function SipDueCard() {
  const { instruments, txns, prices, asOf } = useData();
  const [asking, setAsking] = useState<SipDue | null>(null);
  const due = useMemo(() => sipsDue({ instruments, txns, prices, asOf }), [instruments, txns, prices, asOf]);
  if (due.length === 0 && !asking) return null;
  return (
    <>
      <Card title="Have you paid your SIP?" icon={<IconTrendUp size={15} />}>
        <ul className="flex flex-col divide-y divide-line/70">
          {due.map((s) => (
            <li key={`${s.instrumentId}${s.date}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{s.name}</span>
                <span className="block text-xs text-muted">
                  Due {formatDate(s.date)} · <Money p={s.amount} />
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void skipSip(s.instrumentId, s.date)}>
                Not paid
              </Button>
              <Button size="sm" variant="primary" onClick={() => setAsking(s)}>
                Yes, I paid
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <SipPaidSheet item={asking} onClose={() => setAsking(null)} />
    </>
  );
}

function SipPaidSheet({ item, onClose }: { item: SipDue | null; onClose: () => void }) {
  const { settings } = useData();
  const { accounts } = useAccounts();
  const [nav, setNav] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setNav(item.lastNav);
    setAmount(item.amount);
    setDate(item.date);
    setAccountId(defaultAccountId(accounts, item.accountId, settings.lastAccountId));
    setError(null);
  }, [item]);

  const units = amount && nav ? unitsFor(amount, nav) : 0;

  async function save() {
    if (!item) return;
    if (!nav || nav <= 0) return setError("Enter the NAV the units were allotted at.");
    if (!amount || amount <= 0) return setError("Enter the amount that was debited.");
    if (date > todayISO()) return setError("That date is in the future.");
    try {
      await recordSipPaid({ instrumentId: item.instrumentId, date, amount, nav, accountId: accountId || undefined });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={item ? `Record ${item.name} SIP` : "Record SIP"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Record SIP
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {error && <Callout tone="warn">{error}</Callout>}
        <Field label="Average NAV (₹ per unit)" hint={item?.lastNav ? "Starts from the latest NAV on file. Use the allotment price from your fund app or email; if the SIP was split over days, the average." : "Use the allotment price from your fund app or email."}>
          {(id) => <NumberInput id={id} value={nav} onChange={setNav} placeholder="e.g. 125.4321" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount debited">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {units > 0 && (
          <div className="glass rounded-2xl px-4 py-3 text-sm">
            <b className="num">{units.toLocaleString("en-IN", { maximumFractionDigits: 4 })}</b> units for {formatINR(amount ?? 0)} at ₹{nav}
          </div>
        )}
        {accounts.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-muted">Debited from</div>
            <AccountPicker value={accountId} onChange={setAccountId} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
