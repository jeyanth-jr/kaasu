import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { saveSettings } from "../db/db";
import { rebalanceWithNewMoney } from "../domain/allocation";
import { formatINR, formatPct } from "../domain/money";
import { Badge, Callout, Card, EmptyState, Field, Money, PageHeader, Tabs, Toggle, cx } from "../ui/components";
import { useData } from "../ui/data";
import { CLASS_COLOR, CLASS_LABEL, useAllocation, useEquity } from "../ui/derived";
import { IconAlert } from "../ui/icons";
import { MoneyInput } from "../ui/inputs";

export function AllocationPage() {
  const { settings } = useData();
  const { view, values } = useAllocation();
  const [newMoney, setNewMoney] = useState<number | null>(settings.monthlyBudget);
  const plan = useMemo(() => rebalanceWithNewMoney(values, settings.bands, newMoney ?? 0), [values, settings.bands, newMoney]);

  if (view.total === 0) {
    return (
      <>
        <PageHeader title="Allocation" />
        <EmptyState title="Nothing to allocate yet">Add holdings to compare your mix against your targets.</EmptyState>
      </>
    );
  }

  const pieData = view.rows.filter((r) => r.value > 0).map((r) => ({ name: CLASS_LABEL[r.assetClass], value: r.value, c: r.assetClass }));

  return (
    <>
      <PageHeader title="Allocation" sub={<>Current mix vs your target bands · <Link to="/settings#targets" className="text-accent">edit targets</Link></>} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Mix vs target" className="lg:col-span-3">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="money relative mx-auto h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
                    {pieData.map((d) => (
                      <Cell key={d.c} fill={CLASS_COLOR[d.c]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[11px] text-muted">allocated</span>
                <Money p={view.total} compact className="text-lg font-semibold" />
              </div>
            </div>
            <ul className="flex flex-1 flex-col gap-3">
              {view.rows
                .filter((r) => r.value > 0 || (r.band && r.band.maxPct > 0))
                .map((r) => (
                  <li key={r.assetClass}>
                    <div className="mb-1 flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLOR[r.assetClass] }} />
                      <span className="font-medium">{CLASS_LABEL[r.assetClass]}</span>
                      <span className="num ml-auto font-medium">{formatPct(r.pct)}</span>
                      {r.status === "above" && <Badge tone="warn">Above ▲</Badge>}
                      {r.status === "below" && <Badge tone="warn">Below ▼</Badge>}
                      {r.status === "within" && <Badge tone="accent">In band ✓</Badge>}
                    </div>
                    <BandBar pct={r.pct} min={r.band?.minPct} max={r.band?.maxPct} color={CLASS_COLOR[r.assetClass]} />
                    <div className="mt-0.5 flex justify-between text-[11px] text-faint num">
                      <Money p={r.value} />
                      <span>{r.band ? `target ${r.band.minPct}–${r.band.maxPct}%` : "no target"}</span>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
          <div className="mt-4 border-t border-line pt-2">
            <Toggle
              checked={settings.excludeEmergencyFromAllocation}
              onChange={(v) => void saveSettings({ excludeEmergencyFromAllocation: v })}
              label="Leave instant emergency cash out"
              hint="Savings and sweep-in FDs are a safety net, not part of the investment mix"
            />
            <Toggle
              checked={settings.includeCommitments}
              onChange={(v) => void saveSettings({ includeCommitments: v })}
              label="Include commitments outside the portfolio"
              hint="Also adds them to net worth"
            />
          </div>
        </Card>

        <Card title="Rebalance with new money" className="lg:col-span-2">
          <Field label="Money to invest now" hint="Defaults to your monthly budget">
            {(id) => <MoneyInput id={id} value={newMoney} onChange={setNewMoney} />}
          </Field>
          {plan.split.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {plan.split.map((s) => (
                <li key={s.assetClass} className="flex items-center gap-2 rounded-xl bg-sunken/60 px-3 py-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLOR[s.assetClass] }} />
                  <span>{CLASS_LABEL[s.assetClass]}</span>
                  <Money p={s.amount} className="ml-auto font-semibold" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">Enter an amount to see how to split it.</p>
          )}
          <div className="mt-4 text-xs text-muted">
            {plan.neededToBalance > 0 ? (
              <>
                To bring every class inside its band <em>without selling</em>, you'd need about <Money p={plan.neededToBalance} className="font-medium text-ink" /> of new money in total.
                {plan.stillOutside.length > 0 && (newMoney ?? 0) > 0 && <> After this amount, {plan.stillOutside.map((c) => CLASS_LABEL[c]).join(", ")} will still be outside the band.</>}
              </>
            ) : (
              <>✓ You're inside every band. New money is split by target weights.</>
            )}
          </div>
        </Card>
      </div>

      <EquitySection />
    </>
  );
}

function BandBar({ pct, min, max, color }: { pct: number; min?: number; max?: number; color: string }) {
  const scale = Math.max(100, pct);
  return (
    <div className="relative h-2 rounded-full bg-sunken">
      {min !== undefined && max !== undefined && (
        <div className="absolute inset-y-0 rounded-full bg-ink/15" style={{ left: `${(min / scale) * 100}%`, width: `${Math.max(0.6, ((max - min) / scale) * 100)}%` }} title={`Target ${min}–${max}%`} />
      )}
      <div className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full" style={{ left: `calc(${(pct / scale) * 100}% - 2px)`, background: color }} />
    </div>
  );
}

function EquitySection() {
  const eq = useEquity();
  const { settings } = useData();
  const [tab, setTab] = useState<"segment" | "sector" | "type">("segment");
  if (eq.total === 0) return null;
  const slices = tab === "segment" ? eq.bySegment : tab === "sector" ? eq.bySector : eq.byType;
  const top = eq.exposures.slice(0, 12);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Equity breakdown" action={<Tabs value={tab} onChange={setTab} options={[{ value: "segment", label: "Segment" }, { value: "sector", label: "Sector" }, { value: "type", label: "Type" }]} />}>
        <ul className="flex flex-col gap-2.5">
          {slices.map((s) => (
            <li key={s.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{s.key}</span>
                <span className="shrink-0 num">
                  <span className="font-medium">{formatPct(s.pct)}</span>
                  <span className="ml-2 text-xs text-faint">{tab === "sector" ? "" : `${s.count} · `}<Money p={s.value} compact /></span>
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-sunken">
                <div
                  className={cx("h-full rounded-full", tab === "sector" && s.pct > settings.maxSectorPctOfEquity && !/^Diversified|^Rest of/.test(s.key) ? "bg-warn" : "bg-accent")}
                  style={{ width: `${Math.min(100, s.pct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        {tab === "sector" && (
          <p className="mt-3 text-xs text-muted">
            Funds are split by their pasted top holdings ({formatPct(eq.lookThroughCoverage, { decimals: 0 })} of fund value has look-through data). The rest shows as "not looked through".
          </p>
        )}
      </Card>

      <Card title="Clutter & concentration">
        {eq.flags.length === 0 ? (
          <p className="text-sm text-muted">✓ No clutter or concentration issues with your current limits.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {eq.flags.map((f, i) => (
              <li key={i}>
                <Callout tone={f.severity === "warn" ? "warn" : "neutral"} icon={<IconAlert size={16} className={f.severity === "warn" ? "text-warn" : "text-faint"} />} title={f.title}>
                  {f.detail}
                </Callout>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-faint">
          Limits: positions under {formatINR(settings.minPositionSize)}, more than {settings.maxDirectStocks} stocks, a stock over {settings.maxStockPctOfEquity}% or a sector over {settings.maxSectorPctOfEquity}% of equity. <Link to="/settings#thresholds" className="text-accent">Change</Link>
        </p>
      </Card>

      {top.length > 0 && (
        <Card title="Largest underlying stock exposures" className="lg:col-span-2" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Stock</th>
                  <th className="px-3 py-2 font-medium">Sector</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">% equity</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell sm:px-5">Via</th>
                </tr>
              </thead>
              <tbody>
                {top.map((e) => (
                  <tr key={e.name} className="border-t border-line">
                    <td className="px-4 py-2 font-medium sm:px-5">{e.name}</td>
                    <td className="px-3 py-2 text-muted">{e.sector}</td>
                    <td className="px-3 py-2 text-right">
                      <Money p={Math.round(e.value)} />
                    </td>
                    <td className={cx("px-3 py-2 text-right num", e.pct > settings.maxStockPctOfEquity && "font-semibold text-warn")}>
                      {formatPct(e.pct)}
                      {e.pct > settings.maxStockPctOfEquity && " ▲"}
                    </td>
                    <td className="hidden px-4 py-2 text-xs text-muted sm:table-cell sm:px-5">{e.via.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
