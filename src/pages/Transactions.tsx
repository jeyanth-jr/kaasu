import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAdd } from "../App";
import { undoImport } from "../db/db";
import { financialYear, formatDate, formatMonth, monthKey } from "../domain/dates";
import { sortTxns } from "../domain/lots";
import { formatINR, formatPrice, formatQty } from "../domain/money";
import type { Transaction, TxnType } from "../domain/types";
import { Badge, Button, EmptyState, Input, PageHeader, Select, cx } from "../ui/components";
import { useData } from "../ui/data";
import { IconPlus, IconSearch } from "../ui/icons";

const TYPE_SHORT: Record<TxnType, string> = {
  buy: "Buy",
  sell: "Sell",
  sip: "SIP",
  bonus: "Bonus",
  split: "Split",
  deposit: "Deposit",
  rd_instalment: "RD instalment",
  withdrawal: "Withdrawal",
  interest: "Interest",
  coupon: "Coupon",
  dividend: "Dividend",
  redemption: "Redemption",
  maturity: "Maturity",
  fee: "Fee",
  commitment_payment: "Payment",
  balance_adjust: "Adjustment",
};

/** Sign of a transaction from your wallet's point of view. */
function flowSign(t: Transaction): 1 | -1 | 0 {
  if (["buy", "sip", "deposit", "rd_instalment", "fee", "commitment_payment"].includes(t.type)) return -1;
  if (["sell", "redemption", "withdrawal", "maturity", "dividend", "coupon", "interest"].includes(t.type)) return 1;
  return 0;
}

export function TxnTable({ txns, hideInstrument }: { txns: Transaction[]; hideInstrument?: boolean }) {
  const { instrumentById } = useData();
  const { openAdd } = useAdd();
  const [limit, setLimit] = useState(200);
  const sorted = useMemo(() => sortTxns(txns).reverse(), [txns]);
  if (sorted.length === 0) return <p className="px-5 py-6 text-sm text-muted">No transactions.</p>;
  let lastMonth = "";
  return (
    <div>
      <ul>
        {sorted.slice(0, limit).map((t) => {
          const inst = instrumentById.get(t.instrumentId);
          const m = monthKey(t.date);
          const header = m !== lastMonth;
          lastMonth = m;
          const sign = flowSign(t);
          return (
            <li key={t.id}>
              {header && <div className="sticky top-[calc(49px+env(safe-area-inset-top))] z-[5] border-t border-line bg-sunken/90 px-4 py-1 text-[11px] font-semibold tracking-wider text-faint uppercase backdrop-blur sm:px-5">{formatMonth(m)}</div>}
              <button onClick={() => openAdd({ txnId: t.id })} className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left hover:bg-sunken/60 sm:px-5">
                <span className="w-12 shrink-0 text-xs text-muted num">{formatDate(t.date, { year: false })}</span>
                <span className="min-w-0 flex-1">
                  {!hideInstrument && <span className="block truncate text-sm font-medium">{inst?.name ?? "Unknown instrument"}</span>}
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className={cx(hideInstrument && "text-sm text-ink")}>{TYPE_SHORT[t.type]}</span>
                    {t.qty !== undefined && t.type !== "split" && <span className="num">{formatQty(t.qty)} {t.price ? `@ ${formatPrice(t.price)}` : ""}</span>}
                    {t.type === "split" && <span className="num">×{t.qty}</span>}
                    {t.charges ? <span className="num">+ {formatINR(t.charges, { decimals: 2 })} charges</span> : null}
                    {t.tds ? <span className="num">TDS {formatINR(t.tds)}</span> : null}
                    {t.source === "csv" && <Badge>CSV</Badge>}
                    {t.source === "sample" && <Badge tone="warn">sample</Badge>}
                    {t.notes && <span className="truncate italic">{t.notes}</span>}
                  </span>
                </span>
                <span className={cx("money num shrink-0 text-sm", sign > 0 && "text-gain")}>
                  {t.type === "bonus" || t.type === "split" ? "—" : `${sign > 0 ? "+" : sign < 0 ? "−" : t.amount < 0 ? "−" : "+"}${formatINR(Math.abs(t.amount))}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <Button size="sm" onClick={() => setLimit((l) => l + 200)}>
            Show more ({sorted.length - limit} left)
          </Button>
        </div>
      )}
    </div>
  );
}

export function TransactionsPage() {
  const { txns, instruments, instrumentById } = useData();
  const { openAdd } = useAdd();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | TxnType>("");
  const [fy, setFy] = useState("");
  const [inst, setInst] = useState("");

  const fys = useMemo(() => [...new Set(txns.map((t) => financialYear(t.date).label))].sort().reverse(), [txns]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (type && t.type !== type) return false;
      if (fy && financialYear(t.date).label !== fy) return false;
      if (inst && t.instrumentId !== inst) return false;
      if (term) {
        const name = instrumentById.get(t.instrumentId)?.name.toLowerCase() ?? "";
        if (!name.includes(term) && !(t.notes ?? "").toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [txns, q, type, fy, inst, instrumentById]);

  const batches = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txns) if (t.importBatchId) m.set(t.importBatchId, (m.get(t.importBatchId) ?? 0) + 1);
    return [...m.entries()];
  }, [txns]);

  if (txns.length === 0) {
    return (
      <>
        <PageHeader title="Transactions" />
        <EmptyState
          title="No transactions yet"
          action={
            <>
              <Button variant="primary" onClick={() => openAdd()}>Add transaction</Button>
              <Link to="/settings#import"><Button>Import CSV</Button></Link>
            </>
          }
        >
          Buys, sells, SIPs, deposits, interest and redemptions all live here.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        sub={`${filtered.length} of ${txns.length}`}
        action={
          <div className="hidden md:block">
            <Button variant="primary" onClick={() => openAdd()}>
              <IconPlus size={16} /> Add
            </Button>
          </div>
        }
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <div className="relative sm:col-span-1">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <Input className="pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        </div>
        <Select value={inst} onChange={(e) => setInst(e.target.value)} aria-label="Instrument">
          <option value="">All instruments</option>
          {instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value as TxnType | "")} aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(TYPE_SHORT) as TxnType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_SHORT[t]}
            </option>
          ))}
        </Select>
        <Select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">
          <option value="">All years</option>
          {fys.map((f) => (
            <option key={f} value={f}>
              FY {f}
            </option>
          ))}
        </Select>
      </div>
      {batches.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted">
          {batches.map(([id, n]) => (
            <span key={id} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1">
              CSV import · {n} rows
              <button
                className="font-medium text-loss"
                onClick={async () => {
                  if (!confirm(`Undo this import? Its ${n} transactions and any holdings it created will be deleted.`)) return;
                  await undoImport(id);
                }}
              >
                Undo
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <TxnTable txns={filtered} />
      </div>
    </>
  );
}
