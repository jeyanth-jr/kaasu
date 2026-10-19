import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAdd } from "../App";
import { formatPct, formatQty } from "../domain/money";
import type { Holding } from "../domain/portfolio";
import type { InstrumentKind } from "../domain/types";
import { KIND_LABEL } from "../domain/types";
import { Badge, Button, Change, EmptyState, Money, PageHeader, PctChange, PriceStamp, cx } from "../ui/components";
import { useData } from "../ui/data";
import { IconArrowDown, IconArrowUp, IconPlus } from "../ui/icons";

type Filter = "all" | "equity" | "stock" | "etf" | "mf" | "deposits" | "bond" | "gold" | "cash" | "commitment";
const FILTERS: { v: Filter; l: string; match: (k: InstrumentKind, h: Holding) => boolean }[] = [
  { v: "all", l: "All", match: () => true },
  { v: "equity", l: "Equity", match: (_k, h) => h.instrument.assetClass === "equity" },
  { v: "stock", l: "Stocks", match: (k) => k === "stock" },
  { v: "etf", l: "ETFs", match: (k) => k === "etf" },
  { v: "mf", l: "Funds", match: (k) => k === "mf" },
  { v: "deposits", l: "RD & FD", match: (k) => k === "rd" || k === "fd" },
  { v: "bond", l: "Bonds", match: (k) => k === "bond" },
  { v: "gold", l: "Gold", match: (k) => k === "gold" },
  { v: "cash", l: "Cash", match: (k) => k === "cash" },
  { v: "commitment", l: "Commitments", match: (k) => k === "commitment" },
];

type SortKey = "name" | "value" | "invested" | "pl" | "plPct" | "day" | "xirr" | "weight";

export function HoldingsPage() {
  const { portfolio, settings } = useData();
  const { openAdd } = useAdd();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const [showClosed, setShowClosed] = useState(false);

  const available = FILTERS.filter((f) => f.v === "all" || portfolio.holdings.some((h) => f.match(h.instrument.kind, h)));
  const fdef = FILTERS.find((f) => f.v === filter) ?? FILTERS[0]!;
  const total = portfolio.netWorth || 1;

  const rows = useMemo(() => {
    const list = portfolio.holdings.filter((h) => fdef.match(h.instrument.kind, h) && (showClosed || !h.closed));
    const val = (h: Holding): number | string => {
      switch (sort.key) {
        case "name":
          return h.instrument.name.toLowerCase();
        case "value":
          return h.value;
        case "invested":
          return h.invested;
        case "pl":
          return h.unrealized;
        case "plPct":
          return h.invested > 0 ? h.unrealized / h.invested : -Infinity;
        case "day":
          return h.dayChange ?? -Infinity;
        case "xirr":
          return h.xirr ?? -Infinity;
        case "weight":
          return h.value;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [portfolio, fdef, sort, showClosed]);

  const closedCount = portfolio.holdings.filter((h) => h.closed).length;
  const sumValue = rows.reduce((s, h) => s + h.value, 0);
  const sumInv = rows.reduce((s, h) => s + h.invested, 0);
  const sumPl = rows.reduce((s, h) => s + h.unrealized, 0);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cx("sticky top-[calc(49px+env(safe-area-inset-top))] z-10 bg-paper/95 px-3 py-2 text-xs font-medium text-muted backdrop-blur", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className={cx("inline-flex items-center gap-1 hover:text-ink", className?.includes("text-right") && "flex-row-reverse")} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === "name" ? 1 : -1 }))}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />)}
      </button>
    </th>
  );

  if (portfolio.holdings.length === 0) {
    return (
      <>
        <PageHeader title="Holdings" />
        <EmptyState title="No holdings yet" action={<Button variant="primary" onClick={() => openAdd()}>Add a transaction</Button>}>
          Holdings appear here once you record a buy, SIP or deposit.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Holdings"
        sub={`${portfolio.holdings.filter((h) => !h.closed).length} open positions`}
        action={
          <div className="hidden md:block">
            <Button variant="primary" onClick={() => openAdd()}>
              <IconPlus size={16} /> Add
            </Button>
          </div>
        }
      />
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {available.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={cx("shrink-0 rounded-full border px-3 py-1 text-sm", filter === f.v ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}
          >
            {f.l}
          </button>
        ))}
        {closedCount > 0 && (
          <button onClick={() => setShowClosed((s) => !s)} className={cx("shrink-0 rounded-full border px-3 py-1 text-sm", showClosed ? "border-ink text-ink" : "border-dashed border-line text-faint")}>
            {showClosed ? "Hide" : "Show"} closed ({closedCount})
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left">
              <Th k="name" className="rounded-tl-2xl">Holding</Th>
              <Th k="invested" className="hidden text-right xl:table-cell">Invested</Th>
              <Th k="value" className="text-right">Value</Th>
              <Th k="pl" className="text-right">P/L</Th>
              <Th k="day" className="hidden text-right xl:table-cell">Today</Th>
              <Th k="xirr" className="hidden text-right sm:table-cell md:hidden lg:table-cell">XIRR</Th>
              <Th k="weight" className="hidden rounded-tr-2xl text-right xl:table-cell">Weight</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const inst = h.instrument;
              const excluded = inst.kind === "commitment" && !settings.includeCommitments;
              const plPct = h.invested > 0 ? (h.unrealized / h.invested) * 100 : null;
              return (
                <tr key={inst.id} className={cx("group", h.closed && "opacity-60")}>
                  <td className="w-full max-w-0 border-t border-line px-3 py-2.5 align-top">
                    <Link to={`/holdings/${inst.id}`} className="block min-w-0 group-hover:text-accent">
                      <span className="block font-medium [overflow-wrap:anywhere] line-clamp-2">
                        {inst.name}
                        {inst.sample && <Badge tone="warn" className="ml-1.5 align-middle">sample</Badge>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        <span>{KIND_LABEL[inst.kind]}</span>
                        {h.qty > 0 && <span className="num">{formatQty(h.qty)} {inst.kind === "gold" && inst.details.kind === "gold" && inst.details.form === "physical" ? "g" : "units"}</span>}
                        {h.closed && <span>closed</span>}
                        {excluded && <span>excluded from net worth</span>}
                        {h.book && h.qty > 0 && <PriceStamp point={h.price} ageDays={h.priceAgeDays} />}
                        {!h.book && h.valueSource === "accrual" && <span className="text-faint">accrued estimate</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="hidden border-t border-line px-3 py-2.5 text-right align-top xl:table-cell">
                    <Money p={h.invested} />
                  </td>
                  <td className="border-t border-line px-3 py-2.5 text-right align-top">
                    <Money p={h.value} className="font-medium" />
                    {h.valueSource === "lastTrade" && <div className="text-[11px] text-warn">at last trade</div>}
                  </td>
                  <td className="border-t border-line px-3 py-2.5 text-right align-top">
                    <Change p={h.closed ? h.realized : h.unrealized} hideArrow />
                    <div className="text-xs">{h.closed ? <span className="text-faint">realised</span> : <PctChange pct={plPct} />}</div>
                  </td>
                  <td className="hidden border-t border-line px-3 py-2.5 text-right align-top xl:table-cell">
                    {h.dayChange !== null && h.priceAgeDays !== null && h.priceAgeDays <= 4 ? <Change p={h.dayChange} hideArrow /> : <span className="text-faint">—</span>}
                  </td>
                  <td className="hidden border-t border-line px-3 py-2.5 text-right align-top sm:table-cell md:hidden lg:table-cell">
                    <PctChange pct={h.xirr === null ? null : h.xirr * 100} />
                  </td>
                  <td className="hidden border-t border-line px-3 py-2.5 text-right align-top text-muted num xl:table-cell">{excluded ? "—" : formatPct((h.value / total) * 100)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <td className="border-t border-line px-3 py-2.5 text-muted">Total ({rows.length})</td>
              <td className="hidden border-t border-line px-3 py-2.5 text-right xl:table-cell">
                <Money p={sumInv} />
              </td>
              <td className="border-t border-line px-3 py-2.5 text-right">
                <Money p={sumValue} />
              </td>
              <td className="border-t border-line px-3 py-2.5 text-right">
                <Change p={sumPl} hideArrow />
              </td>
              <td className="hidden border-t border-line xl:table-cell" />
              <td className="hidden border-t border-line sm:table-cell md:hidden lg:table-cell" />
              <td className="hidden border-t border-line xl:table-cell" />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
