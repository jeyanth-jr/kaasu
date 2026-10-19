import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { db, nowISO, requestPersistence, saveSettings } from "../db/db";
import { backupFileName, clearAll, createBackup, parseBackup, restoreBackup } from "../db/backup";
import { clearSampleData, loadSampleData } from "../db/sample";
import { formatDate } from "../domain/dates";
import { ASSET_CLASSES, DEFAULT_TAX, type AllocationBand, type Settings, type TaxConfig } from "../domain/types";
import { proxyOnline, refreshPrices } from "../prices/client";
import { Badge, Button, Callout, Card, Field, Input, PageHeader, Select, Toggle } from "../ui/components";
import { useData } from "../ui/data";
import { CLASS_LABEL } from "../ui/derived";
import { IconDownload, IconUpload } from "../ui/icons";
import { ImportCsv } from "../ui/ImportCsv";
import { MoneyInput, NumberInput } from "../ui/inputs";

function Section({ id, title, children, sub }: { id: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      <Card title={title}>
        {sub && <p className="-mt-1 mb-3 text-sm text-muted">{sub}</p>}
        {children}
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const { settings, instruments, txns, prices } = useData();
  const location = useLocation();
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [location.hash]);

  const set = (patch: Partial<Settings>) => void saveSettings(patch);

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored in this browser only." />
      <div className="flex flex-col gap-4">
        <Section id="profile" title="You">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Monthly expenses" hint="For the emergency-fund meter">
              {(id) => <MoneyInput id={id} value={settings.monthlyExpenses} onChange={(p) => set({ monthlyExpenses: p ?? 0 })} />}
            </Field>
            <Field label="Emergency fund target (months)">
              {(id) => <NumberInput id={id} value={settings.emergencyMonths} onChange={(n) => set({ emergencyMonths: Math.max(0, n ?? 0) })} />}
            </Field>
            <Field label="Monthly investing budget" hint="SIPs + RD + commitments + buffer">
              {(id) => <MoneyInput id={id} value={settings.monthlyBudget} onChange={(p) => set({ monthlyBudget: p ?? 0 })} />}
            </Field>
          </div>
        </Section>

        <Section id="targets" title="Allocation targets" sub="Bands as % of the invested portfolio. The rebalancer aims for the middle of each band.">
          <BandsEditor bands={settings.bands} onChange={(bands) => set({ bands })} />
        </Section>

        <Section id="thresholds" title="Clutter & concentration limits">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Flag positions under">{(id) => <MoneyInput id={id} value={settings.minPositionSize} onChange={(p) => set({ minPositionSize: p ?? 0 })} />}</Field>
            <Field label="Max direct stocks">{(id) => <NumberInput id={id} value={settings.maxDirectStocks} onChange={(n) => set({ maxDirectStocks: Math.max(0, Math.round(n ?? 0)) })} />}</Field>
            <Field label="Max single stock (% of equity)">{(id) => <NumberInput id={id} value={settings.maxStockPctOfEquity} onChange={(n) => set({ maxStockPctOfEquity: n ?? 0 })} />}</Field>
            <Field label="Max sector (% of equity)">{(id) => <NumberInput id={id} value={settings.maxSectorPctOfEquity} onChange={(n) => set({ maxSectorPctOfEquity: n ?? 0 })} />}</Field>
          </div>
        </Section>

        <Section id="tax" title="Tax constants" sub="Change these when a budget changes the rules. All tax screens read from here.">
          <TaxEditor tax={settings.tax} onChange={(tax) => set({ tax })} />
        </Section>

        <Section id="prices" title="Prices">
          <PricesSection />
          <div className="mt-4 border-t border-line pt-3">
            <Field label="Physical gold price per gram" hint="Either enter it manually on the holding, or derive it from a gold ETF's price">
              {(id) => (
                <Select id={id} value={settings.goldPerGramSource} onChange={(e) => set({ goldPerGramSource: e.target.value as "manual" | "etf" })}>
                  <option value="manual">Manual price on each gold holding</option>
                  <option value="etf">Derive from a gold ETF</option>
                </Select>
              )}
            </Field>
            {settings.goldPerGramSource === "etf" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Gold ETF">
                  {(id) => (
                    <Select id={id} value={settings.goldEtfInstrumentId ?? ""} onChange={(e) => set({ goldEtfInstrumentId: e.target.value || undefined })}>
                      <option value="">Choose…</option>
                      {instruments
                        .filter((i) => i.details.kind === "gold" && i.details.form === "etf")
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field label="Grams of gold per ETF unit" hint="From the ETF's factsheet (often ≈ 0.01 g)">
                  {(id) => <NumberInput id={id} value={settings.goldGramsPerEtfUnit ?? null} onChange={(n) => set({ goldGramsPerEtfUnit: n ?? undefined })} />}
                </Field>
              </div>
            )}
          </div>
        </Section>

        <Section id="import" title="Import from CSV">
          <ImportCsv />
          <p className="mt-3 text-xs text-faint">CAS (CAMS/KFintech consolidated statement) PDF import isn't supported yet. Export your CAS transactions to CSV and import them here.</p>
        </Section>

        <Section id="backup" title="Backup & restore" sub="Your data never leaves this device, so backups are your only safety net. Keep the file somewhere safe (it contains your full portfolio).">
          <BackupSection lastBackupAt={settings.lastBackupAt} counts={{ instruments: instruments.length, txns: txns.length, prices: prices.length }} />
        </Section>

        <Section id="sample" title="Sample data">
          <SampleSection hasSample={instruments.some((i) => i.sample)} />
        </Section>

        <Section id="display" title="Display">
          <Toggle checked={settings.privacyMode} onChange={(v) => set({ privacyMode: v })} label="Hide amounts" hint="Blurs every rupee figure — handy in public. Toggle with the eye button too." />
        </Section>

        <Card>
          <p className="text-xs leading-relaxed text-muted">
            Kaasu is a personal tracker, not investment or tax advice. Prices come from AMFI and a public quote source through a proxy on your own machine, and every price shows its date and source. Your holdings never leave this browser.
          </p>
        </Card>
      </div>
    </>
  );
}

function BandsEditor({ bands, onChange }: { bands: AllocationBand[]; onChange: (b: AllocationBand[]) => void }) {
  const get = (c: AllocationBand["assetClass"]) => bands.find((b) => b.assetClass === c) ?? { assetClass: c, minPct: 0, maxPct: 0 };
  const update = (c: AllocationBand["assetClass"], patch: Partial<AllocationBand>) => onChange(ASSET_CLASSES.map((x) => (x === c ? { ...get(x), ...patch } : get(x))));
  const minSum = ASSET_CLASSES.reduce((s, c) => s + get(c).minPct, 0);
  const maxSum = ASSET_CLASSES.reduce((s, c) => s + get(c).maxPct, 0);
  return (
    <>
      <div className="grid gap-2">
        {ASSET_CLASSES.map((c) => {
          const b = get(c);
          return (
            <div key={c} className="grid grid-cols-[5rem_1fr_1fr] items-center gap-2">
              <span className="text-sm font-medium">{CLASS_LABEL[c]}</span>
              <NumberInput value={b.minPct} onChange={(n) => update(c, { minPct: Math.max(0, n ?? 0) })} placeholder="min %" />
              <NumberInput value={b.maxPct} onChange={(n) => update(c, { maxPct: Math.max(0, n ?? 0) })} placeholder="max %" />
            </div>
          );
        })}
      </div>
      <p className={`mt-2 text-xs ${minSum > 100 || maxSum < 100 ? "text-warn" : "text-muted"}`}>
        Minimums add up to {minSum}% and maximums to {maxSum}%. {minSum > 100 ? "Minimums above 100% can't all be met." : maxSum < 100 ? "Maximums below 100% can't all be met." : "These bands are achievable."}
      </p>
    </>
  );
}

function TaxEditor({ tax, onChange }: { tax: TaxConfig; onChange: (t: TaxConfig) => void }) {
  const n = (k: keyof TaxConfig, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <NumberInput id={id} value={tax[k] as number} onChange={(v) => onChange({ ...tax, [k]: v ?? 0 })} />}
    </Field>
  );
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Rule set label" className="sm:col-span-3">
          {(id) => <Input id={id} value={tax.label} onChange={(e) => onChange({ ...tax, label: e.target.value })} />}
        </Field>
        {n("equityStcgPct", "Equity STCG %")}
        {n("equityLtcgPct", "Equity LTCG %")}
        <Field label="Equity LTCG exemption / year">{(id) => <MoneyInput id={id} value={tax.equityLtcgExemption} onChange={(p) => onChange({ ...tax, equityLtcgExemption: p ?? 0 })} />}</Field>
        {n("equityLtMonths", "Equity long-term after (months)")}
        {n("listedOtherLtcgPct", "Other listed LTCG %", "Gold ETFs, listed bonds")}
        {n("listedOtherLtMonths", "Other listed long-term after (months)")}
        {n("unlistedOtherLtcgPct", "Unlisted LTCG %", "Physical gold, unlisted bonds")}
        {n("unlistedOtherLtMonths", "Unlisted long-term after (months)")}
        {n("slabPct", "Your slab rate % (incl. cess)", "New regime, e.g. 31.2 for the 30% slab")}
        {n("cessPct", "Cess % on capital gains")}
      </div>
      <Button size="sm" variant="ghost" className="mt-3" onClick={() => onChange(DEFAULT_TAX)}>
        Reset to {DEFAULT_TAX.label}
      </Button>
    </>
  );
}

function PricesSection() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void proxyOnline().then(setOnline);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Price proxy:
        {online === null ? <Badge>checking…</Badge> : online ? <Badge tone="accent">running</Badge> : <Badge tone="warn">not running</Badge>}
      </div>
      {online === false && (
        <Callout tone="neutral">
          Start it with <code className="rounded bg-sunken px-1">npm run dev</code> (or <code className="rounded bg-sunken px-1">npm run proxy</code>). Without it you can still enter prices manually on each holding.
        </Callout>
      )}
      <p className="text-sm text-muted">Fund NAVs come from AMFI's daily NAV file (cached for the day). Stock and ETF prices come from Yahoo Finance's public chart endpoint, which is unofficial and may stop working; manual prices are the fallback.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await refreshPrices();
            setOnline(r.proxyOnline);
            setMsg(r.message + (r.failed.length ? ` — ${r.failed.map((f) => `${f.name}: ${f.reason}`).join("; ")}` : ""));
            setBusy(false);
          }}
        >
          {busy ? "Refreshing…" : "Refresh prices now"}
        </Button>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

function BackupSection({ lastBackupAt, counts }: { lastBackupAt?: string; counts: { instruments: number; txns: number; prices: number } }) {
  const [msg, setMsg] = useState<{ tone: "accent" | "warn"; text: string } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  async function download() {
    const backup = await createBackup();
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await saveSettings({ lastBackupAt: nowISO() });
    setMsg({ tone: "accent", text: `Saved ${backup.data.instruments.length} instruments and ${backup.data.txns.length} transactions.` });
  }

  async function restore(file: File) {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) return setMsg({ tone: "warn", text: parsed.error });
    const d = parsed.backup.data;
    if (!confirm(`Replace everything here with this backup from ${formatDate(parsed.backup.exportedAt.slice(0, 10))}? (${d.instruments.length} instruments, ${d.txns.length} transactions). Current data will be overwritten.`)) return;
    const r = await restoreBackup(parsed.backup);
    setMsg(r.ok ? { tone: "accent", text: `Restored ${r.counts.instruments} instruments and ${r.counts.transactions} transactions.` } : { tone: "warn", text: r.error });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={download}>
          <IconDownload size={16} /> Download backup (.json)
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-sunken">
          <IconUpload size={16} /> Restore from file
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        </label>
      </div>
      <p className="text-xs text-muted">
        {counts.instruments} instruments · {counts.txns} transactions · {counts.prices} price points ·{" "}
        {lastBackupAt ? `last backup ${formatDate(lastBackupAt.slice(0, 10))}` : "never backed up"}
      </p>
      <p className="text-xs text-muted">
        Browser storage: {persisted === null ? "unknown" : persisted ? "persistent ✓ (won't be cleared automatically)" : "best-effort — the browser may evict it under storage pressure."}{" "}
        {persisted === false && (
          <button className="font-medium text-accent" onClick={async () => setPersisted(await requestPersistence())}>
            Ask for persistent storage
          </button>
        )}
      </p>
      {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">Danger zone</summary>
        <div className="mt-2">
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Delete ALL instruments, transactions and prices from this browser? Download a backup first.")) return;
              if (!confirm("Really delete everything? This cannot be undone.")) return;
              await clearAll();
              await db.settings.update("settings", { sampleLoaded: false });
              setMsg({ tone: "accent", text: "All data deleted." });
            }}
          >
            Delete all data
          </Button>
        </div>
      </details>
    </div>
  );
}

function SampleSection({ hasSample }: { hasSample: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">A fictional portfolio (stocks, SIPs, RD, FD, NCD, gold, a commitment and an EMI) to explore every screen. Every sample row is tagged and can be removed without touching your own data.</p>
      <div>
        {hasSample ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await clearSampleData();
              setBusy(false);
            }}
          >
            Clear sample data
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await loadSampleData();
              setBusy(false);
            }}
          >
            Load sample data
          </Button>
        )}
      </div>
    </div>
  );
}
