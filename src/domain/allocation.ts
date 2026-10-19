import type { AllocationBand, AssetClass, Paise } from "./types";

export interface ClassRow {
  assetClass: AssetClass;
  value: Paise;
  pct: number;
  band: AllocationBand | null;
  status: "below" | "within" | "above" | "untargeted";
}

export interface AllocationView {
  total: Paise;
  rows: ClassRow[];
}

export function allocationView(values: Partial<Record<AssetClass, Paise>>, bands: AllocationBand[]): AllocationView {
  const classes = new Set<AssetClass>([...bands.map((b) => b.assetClass), ...(Object.keys(values) as AssetClass[])]);
  const total = [...classes].reduce((s, c) => s + Math.max(0, values[c] ?? 0), 0);
  const rows: ClassRow[] = [...classes].map((c) => {
    const value = Math.max(0, values[c] ?? 0);
    const pct = total > 0 ? (value / total) * 100 : 0;
    const band = bands.find((b) => b.assetClass === c) ?? null;
    const status: ClassRow["status"] = !band
      ? "untargeted"
      : pct < band.minPct - 1e-9
        ? "below"
        : pct > band.maxPct + 1e-9
          ? "above"
          : "within";
    return { assetClass: c, value, pct, band, status };
  });
  rows.sort((a, b) => b.value - a.value);
  return { total, rows };
}

export interface RebalancePlan {
  /** How to split `newMoney` across classes. */
  split: { assetClass: AssetClass; amount: Paise }[];
  /** Fresh money needed so every class lands inside its band without selling. */
  neededToBalance: Paise;
  /** Classes still outside their band after investing `newMoney` per the split. */
  stillOutside: AssetClass[];
}

/**
 * Rebalance with new money first (no selling). Targets are band midpoints,
 * renormalised to 100%. Deficits versus the post-investment total are funded
 * first; any surplus is spread by target weight.
 */
export function rebalanceWithNewMoney(
  values: Partial<Record<AssetClass, Paise>>,
  bands: AllocationBand[],
  newMoney: Paise,
): RebalancePlan {
  const targeted = bands.filter((b) => b.maxPct > 0);
  // A band with a 0% minimum is a cap ("at most 5% cash"), not something to buy into.
  const buyable = targeted.some((b) => b.minPct > 0) ? targeted.filter((b) => b.minPct > 0) : targeted;
  const mids = buyable.map((b) => ({ c: b.assetClass, w: (b.minPct + b.maxPct) / 2 }));
  const wSum = mids.reduce((s, m) => s + m.w, 0) || 1;
  const current = (c: AssetClass) => Math.max(0, values[c] ?? 0);
  const total = Object.values(values).reduce<number>((s, v) => s + Math.max(0, v ?? 0), 0);
  const after = total + Math.max(0, newMoney);

  const deficits = mids.map((m) => ({ c: m.c, d: Math.max(0, (m.w / wSum) * after - current(m.c)) }));
  const dSum = deficits.reduce((s, x) => s + x.d, 0);
  const amounts = new Map<AssetClass, number>();
  if (newMoney > 0) {
    if (dSum >= newMoney) {
      for (const x of deficits) amounts.set(x.c, (x.d / dSum) * newMoney);
    } else {
      const surplus = newMoney - dSum;
      for (const x of deficits) {
        const w = mids.find((m) => m.c === x.c)!.w / wSum;
        amounts.set(x.c, x.d + surplus * w);
      }
    }
  }
  const split = roundSplit(
    mids.map((m) => ({ assetClass: m.c, amount: amounts.get(m.c) ?? 0 })),
    Math.max(0, newMoney),
  ).filter((s) => s.amount > 0);

  // Minimum N such that no class exceeds its max (overweights shrink as total grows)
  // and every underweight can be lifted to its min with the new money.
  let needed = 0;
  for (const b of targeted) {
    const v = current(b.assetClass);
    if (b.maxPct > 0 && v > 0) needed = Math.max(needed, Math.ceil((v * 100) / b.maxPct - total));
  }
  // With total T' = T + N, underweights need min% × T' − v of the N.
  const fits = (n: number) => {
    const t = total + n;
    let need = 0;
    for (const b of targeted) need += Math.max(0, (b.minPct / 100) * t - current(b.assetClass));
    return need <= n + 1;
  };
  if (!fits(needed)) {
    let lo = needed;
    let hi = Math.max(needed * 2, total * 10, 1_00);
    while (!fits(hi) && hi < 1e15) hi *= 2;
    while (hi - lo > 100) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    needed = hi;
  }

  const afterValues = new Map<AssetClass, number>();
  for (const m of mids) afterValues.set(m.c, current(m.c) + (split.find((s) => s.assetClass === m.c)?.amount ?? 0));
  const stillOutside = targeted
    .filter((b) => {
      const pct = after > 0 ? ((afterValues.get(b.assetClass) ?? 0) / after) * 100 : 0;
      return pct < b.minPct - 0.05 || pct > b.maxPct + 0.05;
    })
    .map((b) => b.assetClass);

  return { split, neededToBalance: Math.max(0, needed), stillOutside };
}

/** Round to whole rupees while keeping the exact total. */
function roundSplit<T extends { amount: number }>(items: T[], total: Paise): T[] {
  const floor = items.map((i) => ({ ...i, amount: Math.floor(i.amount / 100) * 100, frac: i.amount % 100 }));
  let rest = Math.round(total - floor.reduce((s, i) => s + i.amount, 0));
  const order = [...floor.keys()].sort((a, b) => floor[b]!.frac - floor[a]!.frac);
  for (const idx of order) {
    if (rest <= 0) break;
    const add = Math.min(rest, 100);
    floor[idx]!.amount += add;
    rest -= add;
  }
  if (rest > 0 && floor[0]) floor[0].amount += rest;
  return floor.map(({ frac: _f, ...i }) => i as unknown as T);
}
