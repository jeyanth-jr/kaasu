import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { financialYear, formatDate } from "../domain/dates";
import { formatINR, formatQty } from "../domain/money";
import {
  BUCKET_LABEL,
  addBuckets,
  bucketize,
  computeTax,
  emptyBuckets,
  harvestZeroTax,
  lotViews,
  termOf,
  turningLongSoon,
  type Bucket,
  type HarvestInput,
  type LotTaxView,
} from "../domain/tax";
import type { Holding } from "../domain/portfolio";
import { Badge, Callout, Card, Change, EmptyState, Meter, Money, PageHeader, Select, Stat, Tabs, cx } from "../ui/components";
import { useData } from "../ui/data";

export function TaxPage() {
  const { portfolio, settings, asOf, instrumentById, txns } = useData();
  const cfg = settings.tax;
  const currentFy = financialYear(asOf);

  const allRealized = useMemo(
    () =>
      portfolio.holdings.flatMap((h) =>
        (h.book?.realized ?? []).map((lot) => ({ taxClass: h.instrument.taxClass, lot, instrumentId: h.instrument.id })),
      ),
    [portfolio],
  );
  const fyOptions = useMemo(() => {
    const set = new Set([currentFy.label, ...allRealized.map((r) => financialYear(r.lot.sellDate).label)]);
    return [...set].sort().reverse();
  }, [allRealized, currentFy.label]);
  const [fyLabel, setFyLabel] = useState(currentFy.label);
  const fy = financialYear(`${fyLabel.slice(0, 4)}-06-01`);
  const isCurrent = fyLabel === currentFy.label;

  const realizedFy = allRealized.filter((r) => r.lot.sellDate >= fy.start && r.lot.sellDate <= fy.end);
  const realizedBuckets = bucketize(
    realizedFy.map((r) => ({ taxClass: r.taxClass, buyDate: r.lot.buyDate, sellDate: r.lot.sellDate, gain: r.lot.gain })),
    cfg,
  );
  const realizedTax = computeTax(realizedBuckets, cfg);

  const lots: (LotTaxView & { name: string })[] = useMemo(
    () =>
      portfolio.holdings.flatMap((h) =>
        h.book && h.qty > 0 && h.instrument.taxClass !== "none"
          ? lotViews(h.instrument.id, h.instrument.taxClass, h.book.open, h.price?.price ?? lastPrice(h), asOf, cfg).map((l) => ({ ...l, name: h.instrument.name }))
          : [],
      ),
    [portfolio, asOf, cfg],
  );

  const unrealizedBuckets = emptyBuckets();
  for (const l of lots) if (l.bucket && l.gain !== null) unrealizedBuckets[l.bucket] += l.gain;
  const taxIfSoldAll = computeTax(addBuckets(realizedBuckets, unrealizedBuckets), cfg).tax - realizedTax.tax;
  const stUnreal = unrealizedBuckets.equitySt + unrealizedBuckets.otherSt + unrealizedBuckets.slab;
  const ltUnreal = unrealizedBuckets.equityLt + unrealizedBuckets.listedLt + unrealizedBuckets.unlistedLt;

  const harvest = useMemo(() => {
    if (!isCurrent) return null;
    const inputs: HarvestInput[] = portfolio.holdings
      .filter((h) => h.book && h.qty > 0 && h.instrument.taxClass === "equity" && (h.price || lastPrice(h)))
      .map((h) => ({
        instrumentId: h.instrument.id,
        taxClass: h.instrument.taxClass,
        unitStep: h.instrument.kind === "mf" ? 0.001 : 1,
        price: h.price?.price ?? lastPrice(h)!,
        lots: h.book!.open,
      }));
    return harvestZeroTax(inputs, realizedBuckets, asOf, cfg);
  }, [portfolio, isCurrent, asOf, cfg, fy.start]);

  const soon = useMemo(
    () =>
      portfolio.holdings.flatMap((h) => {
        const p = h.price?.price ?? lastPrice(h);
        return h.book && p ? turningLongSoon(h.instrument.id, h.instrument.taxClass, h.book.open, p, asOf, 60, cfg) : [];
      }),
    [portfolio, asOf, cfg],
  );

  // Interest-type income recorded this FY (taxed at slab).
  const incomeRows = txns.filter((t) => ["interest", "coupon", "dividend"].includes(t.type) && t.date >= fy.start && t.date <= fy.end);
  const incomeTotal = incomeRows.reduce((s, t) => s + t.amount, 0);
  const tdsTotal = incomeRows.reduce((s, t) => s + (t.tds ?? 0), 0);

  if (lots.length === 0 && allRealized.length === 0) {
    return (
      <>
        <PageHeader title="Tax" />
        <EmptyState title="No tax lots yet">Buy stocks, ETFs, funds, gold or bonds to see holding periods and capital-gains splits here.</EmptyState>
      </>
    );
  }

  const exemption = cfg.equityLtcgExemption;
  return (
    <>
      <PageHeader
        title="Tax"
        sub={
          <>
            {cfg.label} · <Link to="/settings#tax" className="text-accent">edit rates</Link> · Estimates, not tax advice
          </>
        }
        action={
          <Select value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} aria-label="Financial year" className="w-auto">
            {fyOptions.map((f) => (
              <option key={f} value={f}>
                FY {f}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Realised in FY ${fyLabel}`} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Equity STCG" value={<Change p={realizedBuckets.equitySt} hideArrow />} sub={`taxed at ${cfg.equityStcgPct}%`} />
            <Stat label="Equity LTCG" value={<Change p={realizedBuckets.equityLt} hideArrow />} sub={`${cfg.equityLtcgPct}% above ${formatINR(exemption)}`} />
            <Stat label="Other gains" value={<Change p={realizedBuckets.otherSt + realizedBuckets.listedLt + realizedBuckets.unlistedLt + realizedBuckets.slab} hideArrow />} sub="gold, bonds, debt funds" />
          </div>
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>LTCG exemption used</span>
              <span className="num">
                <Money p={realizedTax.exemptionUsed} /> of <Money p={exemption} />
              </span>
            </div>
            <Meter value={realizedTax.exemptionUsed} max={exemption} label="LTCG exemption used" />
            <p className="mt-2 text-sm">
              <span className="font-medium">
                <Money p={realizedTax.exemptionRemaining} /> of tax-free equity LTCG left
              </span>
              <span className="text-muted"> {isCurrent ? "this year" : "unused"}.</span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
            <span>
              Estimated tax on realised gains: <Money p={realizedTax.tax} className="font-semibold" />
            </span>
            {realizedTax.unabsorbedSt + realizedTax.unabsorbedLt > 0 && (
              <span className="text-muted">
                Losses to carry forward: <Money p={realizedTax.unabsorbedSt + realizedTax.unabsorbedLt} />
              </span>
            )}
          </div>
          <BucketTable net={realizedTax.net} tax={realizedTax.taxByBucket} />
        </Card>

        <Card title="Unrealised today">
          <div className="grid gap-4">
            <Stat label="Short-term" value={<Change p={stUnreal} hideArrow />} />
            <Stat label="Long-term" value={<Change p={ltUnreal} hideArrow />} />
            <Stat label="Extra tax if you sold everything today" value={<Money p={taxIfSoldAll} />} sub="after set-off and the remaining exemption" />
          </div>
        </Card>
      </div>

      {isCurrent && harvest && (
        <Card title="Harvest helper · sell with zero tax this FY" className="mt-4">
          {harvest.suggestions.length === 0 ? (
            <p className="text-sm text-muted">
              {realizedTax.exemptionRemaining <= 0
                ? "The exemption is used up for this year."
                : "No long-term gains reachable without first selling short-term lots at a gain (sales always use your oldest units first)."}
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                Selling these books gains inside the remaining exemption, so you pay no tax. Buying back resets your cost higher and lowers future tax. Sales always use your oldest units first (FIFO), and that's already accounted for.
              </p>
              <ul className="divide-y divide-line">
                {harvest.suggestions.map((s) => (
                  <li key={s.instrumentId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <Link to={`/holdings/${s.instrumentId}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                      {instrumentById.get(s.instrumentId)?.name}
                    </Link>
                    <span className="num">Sell {formatQty(s.qty)} units</span>
                    <span className="text-muted">
                      ≈ <Money p={s.proceeds} />
                    </span>
                    <Change p={s.gain} hideArrow />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-faint">
                Exemption left after these: <Money p={harvest.exemptionLeftAfter} />. India currently has no wash-sale rule for this, but rules change, so check before you act. Exit loads and charges aren't included.
              </p>
            </>
          )}
        </Card>
      )}

      {soon.length > 0 && (
        <Card title="Turning long-term in the next 60 days" className="mt-4">
          <ul className="divide-y divide-line">
            {soon
              .sort((a, b) => a.daysLeft - b.daysLeft)
              .map((s) => (
                <li key={s.lot.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{instrumentById.get(s.instrumentId)?.name}</span>
                  <span className="num text-muted">{formatQty(s.lot.qty)} units bought {formatDate(s.lot.date)}</span>
                  <Badge tone="accent">LT on {formatDate(s.longTermFrom)} · {s.daysLeft}d</Badge>
                  <span className="text-xs text-muted">
                    waiting saves ≈ <Money p={s.taxSaved} />
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <LotsTable lots={lots} />

      {realizedFy.length > 0 && (
        <Card title={`Realised lots · FY ${fyLabel}`} className="mt-4" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Holding</th>
                  <th className="px-3 py-2 font-medium">Bought → Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Gain</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Term</th>
                </tr>
              </thead>
              <tbody>
                {realizedFy.map((r, i) => {
                  const term = termOf(r.taxClass, r.lot.buyDate, r.lot.sellDate, cfg);
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="px-4 py-2 sm:px-5">{instrumentById.get(r.instrumentId)?.name}</td>
                      <td className="px-3 py-2 text-xs text-muted num whitespace-nowrap">
                        {formatDate(r.lot.buyDate)} → {formatDate(r.lot.sellDate)}
                      </td>
                      <td className="px-3 py-2 text-right num">{formatQty(r.lot.qty)}</td>
                      <td className="px-3 py-2 text-right">
                        <Change p={r.lot.gain} hideArrow />
                      </td>
                      <td className="px-4 py-2 sm:px-5">{r.taxClass === "slab" ? <Badge>slab</Badge> : term === "long" ? <Badge tone="accent">Long</Badge> : <Badge>Short</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`Interest & dividend income · FY ${fyLabel}`} className="mt-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Recorded income" value={<Money p={incomeTotal} />} sub={`${incomeRows.length} entries`} />
          <Stat label="TDS deducted" value={<Money p={tdsTotal} />} />
          <Stat label={`Tax at your ${cfg.slabPct}% slab`} value={<Money p={Math.max(0, Math.round((incomeTotal * cfg.slabPct) / 100) - tdsTotal)} />} sub="after TDS credit" />
        </div>
        <p className="mt-3 text-xs text-faint">Cumulative FD/RD interest is taxable as it accrues each year even if paid at maturity. Record yearly interest entries if you want them counted here.</p>
      </Card>

      <div className="mt-4">
        <Callout tone="neutral" title="How this is calculated">
          Lots are matched first-in-first-out. Listed equity and equity funds turn long-term after more than {cfg.equityLtMonths} months. Set-off follows the usual order: short-term losses can offset any gains, long-term losses only long-term gains. Cess at {cfg.cessPct}% is included; surcharge, carried-forward losses and pre-2018 grandfathering are not. Not tax advice.
        </Callout>
      </div>
    </>
  );
}

/** Unit price used for valuation: the stored price, else the last trade price. */
function lastPrice(h: Holding): number | null {
  if (h.price) return h.price.price;
  if (h.valueSource === "lastTrade" && h.qty > 0) return h.value / 100 / h.qty;
  return null;
}

function BucketTable({ net, tax }: { net: Record<Bucket, number>; tax: Record<Bucket, number> }) {
  const rows = (Object.keys(net) as Bucket[]).filter((k) => net[k] !== 0 || tax[k] !== 0);
  if (rows.length === 0) return null;
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="py-1 font-medium">After set-off</th>
          <th className="py-1 text-right font-medium">Net gain</th>
          <th className="py-1 text-right font-medium">Tax</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((k) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1.5">{BUCKET_LABEL[k]}</td>
            <td className="py-1.5 text-right">
              <Money p={net[k]} />
            </td>
            <td className="py-1.5 text-right">
              <Money p={tax[k]} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LotsTable({ lots }: { lots: (LotTaxView & { name: string })[] }) {
  const [term, setTerm] = useState<"all" | "short" | "long">("all");
  const [sort, setSort] = useState<"lt" | "gain" | "name">("lt");
  const shown = lots
    .filter((l) => term === "all" || l.term === term)
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "gain" ? (b.gain ?? 0) - (a.gain ?? 0) : (a.longTermFrom ?? "9999") < (b.longTermFrom ?? "9999") ? -1 : 1,
    );
  return (
    <Card
      title={`All open lots (${lots.length})`}
      className="mt-4"
      pad={false}
      action={
        <div className="flex flex-wrap gap-2">
          <Tabs value={term} onChange={setTerm} options={[{ value: "all", label: "All" }, { value: "short", label: "Short" }, { value: "long", label: "Long" }]} />
          <Select value={sort} onChange={(e) => setSort(e.target.value as "lt")} aria-label="Sort lots" className="w-auto py-1 text-xs">
            <option value="lt">By long-term date</option>
            <option value="gain">By gain</option>
            <option value="name">By name</option>
          </Select>
        </div>
      }
    >
      <div className="overflow-x-auto pt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium sm:px-5">Holding</th>
              <th className="px-3 py-2 font-medium">Bought</th>
              <th className="px-3 py-2 text-right font-medium">Days</th>
              <th className="px-3 py-2 font-medium">Long-term from</th>
              <th className="px-3 py-2 text-right font-medium">Units</th>
              <th className="px-4 py-2 text-right font-medium sm:px-5">Unrealised</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={`${l.instrumentId}-${l.lot.id}`} className="border-t border-line">
                <td className="max-w-[12rem] truncate px-4 py-2 sm:px-5">{l.name}</td>
                <td className="px-3 py-2 num whitespace-nowrap">{formatDate(l.lot.date)}</td>
                <td className="px-3 py-2 text-right num">{l.holdingDays}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {l.longTermFrom === null ? <Badge>slab — never</Badge> : l.term === "long" ? <Badge tone="accent">Long ✓</Badge> : <span className={cx("num")}>{formatDate(l.longTermFrom)}</span>}
                </td>
                <td className="px-3 py-2 text-right num">{formatQty(l.lot.qty)}</td>
                <td className="px-4 py-2 text-right sm:px-5">{l.gain === null ? <span className="text-xs text-warn">no price</span> : <Change p={l.gain} hideArrow />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
