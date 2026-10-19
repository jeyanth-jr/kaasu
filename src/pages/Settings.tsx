import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTour } from "../App";
import { db, nowISO, requestPersistence, saveSettings } from "../db/db";
import { backupFileName, clearAll, createBackup, parseBackup, restoreBackup } from "../db/backup";
import { decryptText, encryptText, isEncrypted } from "../db/crypto";
import { clearSampleData, loadSampleData } from "../db/sample";
import { accountLedger, activeAccounts } from "../domain/accounts";
import { categoryOf } from "../domain/cashflow";
import { formatDate } from "../domain/dates";
import { ASSET_CLASSES, DEFAULT_TAX, type AllocationBand, type Settings, type TaxConfig } from "../domain/types";
import { proxyOnline, refreshPrices } from "../prices/client";
import { Badge, Button, Callout, Card, Field, Input, PageHeader, Select, Toggle } from "../ui/components";
import { useData } from "../ui/data";
import { CLASS_LABEL } from "../ui/derived";
import { IconDownload, IconUpload } from "../ui/icons";
import { describeKey } from "../domain/savings";
import { celebrate } from "../ui/celebrate";
import { ImportCsv } from "../ui/ImportCsv";
import { syncConfigured } from "../sync/config";

const SyncPanel = lazy(() => import("../sync/SyncPanel").then((m) => ({ default: m.SyncPanel })));
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
  const { openTour } = useTour();

  return (
    <>
      <PageHeader title="Settings" sub={syncConfigured ? "Your account, preferences and data." : "Everything is stored in this browser only."} />
      <div className="flex flex-col gap-4">
        {syncConfigured && (
          <Section id="account" title="Account & sync" sub="Back up to the cloud and keep your phone and laptop in step.">
            <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
              <SyncPanel />
            </Suspense>
          </Section>
        )}

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
          <Field label="Stock & ETF prices from" hint="Mutual fund NAVs always come from AMFI. If the chosen source fails for a symbol, the other one is tried automatically.">
            {(id) => (
              <Select id={id} value={settings.quoteSource} onChange={(e) => set({ quoteSource: e.target.value as "google" | "yahoo" })} className="max-w-xs">
                <option value="google">Google Finance (like GOOGLEFINANCE in Sheets)</option>
                <option value="yahoo">Yahoo Finance</option>
              </Select>
            )}
          </Field>
          <div className="mt-4" />
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

        <Section id="backup" title="Backup & restore" sub={syncConfigured ? "Your data is saved to your account. A backup file is an extra copy you keep yourself. Store it somewhere safe: it contains your full portfolio." : "Your data never leaves this device, so backups are your only safety net. Keep the file somewhere safe (it contains your full portfolio)."}>
          <BackupSection lastBackupAt={settings.lastBackupAt} counts={{ instruments: instruments.length, txns: txns.length, prices: prices.length }} />
        </Section>

        <Section id="sample" title="Sample data">
          <SampleSection hasSample={instruments.some((i) => i.sample)} />
        </Section>

        <Section id="help" title="Help" sub="New here? Replay the tour or read the guide to importing your data.">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={openTour}>
              Replay the tour
            </Button>
            <Link to="/help#import">
              <Button size="sm" variant="secondary">
                How to import data
              </Button>
            </Link>
          </div>
        </Section>

        <Section id="celebrations" title="Celebrations" sub="Confetti, a toast and a buzz when you hit a savings milestone: 25/50/75/100% of your monthly goal, streaks, net-worth levels and emergency-fund runway.">
          <Toggle checked={settings.celebrations} onChange={(v) => set({ celebrations: v })} label="Celebrate my wins" hint="Respects your device's reduced-motion setting" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => previewWin("goal:preview:25")}>
              Small
            </Button>
            <Button size="sm" onClick={() => previewWin("goal:preview:75")}>
              Medium
            </Button>
            <Button size="sm" onClick={() => previewWin("goal:preview:100")}>
              Big
            </Button>
          </div>
        </Section>

        <Section id="display" title="Display">
          <Toggle checked={settings.privacyMode} onChange={(v) => set({ privacyMode: v })} label="Hide amounts" hint="Blurs every rupee figure — handy in public. Toggle with the eye button too." />
        </Section>

        <Card>
          <p className="text-xs leading-relaxed text-muted">
            Kaasu is a personal tracker, not investment, tax or legal advice, and not a SEBI-registered adviser. Fund NAVs come from AMFI and stock prices from Google or Yahoo Finance through our price service, which only sees the symbols and scheme codes you track. Every price shows its date and source and may be delayed.
          </p>
          <p className="mt-2 flex gap-4 text-xs font-semibold">
            <Link to="/privacy" className="text-accent">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-accent">
              Terms of Use
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}

function previewWin(key: string): void {
  const w = describeKey(key);
  if (w) celebrate(w);
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
      <p className="text-sm text-muted">
        Fund NAVs come from AMFI's daily NAV file (cached for the day). Stock and ETF prices are read from Google Finance's quote page or Yahoo Finance's chart endpoint. Neither is an official API, so either can change without notice; manual prices are always the last resort. BSE symbols on Google Finance need the numeric scrip code (e.g. 500325).
      </p>
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
  const [passphrase, setPassphrase] = useState("");
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  async function download() {
    const backup = await createBackup();
    const plain = JSON.stringify(backup, null, 1);
    const body = passphrase ? JSON.stringify(await encryptText(plain, passphrase)) : plain;
    saveFile(body, passphrase ? backupFileName().replace(".json", ".encrypted.json") : backupFileName(), "application/json");
    await saveSettings({ lastBackupAt: nowISO() });
    setMsg({
      tone: "accent",
      text: `Saved ${backup.data.instruments.length} instruments and ${backup.data.txns.length} transactions${passphrase ? ", encrypted. Without the passphrase this file can't be restored" : ""}.`,
    });
  }

  async function restore(file: File) {
    let text = await file.text();
    try {
      const json: unknown = JSON.parse(text);
      if (isEncrypted(json)) {
        const pass = prompt("This backup is encrypted. Enter its passphrase:");
        if (!pass) return;
        const plain = await decryptText(json, pass);
        if (plain === null) return setMsg({ tone: "warn", text: "Wrong passphrase, or the file was modified." });
        text = plain;
      }
    } catch {
      /* parseBackup reports invalid JSON */
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) return setMsg({ tone: "warn", text: parsed.error });
    const d = parsed.backup.data;
    if (!confirm(`Replace everything here with this backup from ${formatDate(parsed.backup.exportedAt.slice(0, 10))}? (${d.instruments.length} instruments, ${d.txns.length} transactions). Current data will be overwritten.`)) return;
    const r = await restoreBackup(parsed.backup);
    setMsg(r.ok ? { tone: "accent", text: `Restored ${r.counts.instruments} instruments and ${r.counts.transactions} transactions.` } : { tone: "warn", text: r.error });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Passphrase (optional)" hint="Encrypts the backup file in your browser (AES-256). Forget it and the file is unreadable.">
        {(id) => <Input id={id} type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="max-w-xs" />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={download}>
          <IconDownload size={16} /> {passphrase ? "Download encrypted backup" : "Download backup (.json)"}
        </Button>
        <Button onClick={() => void exportTxnsCsv()}>
          <IconDownload size={16} /> Investments as CSV
        </Button>
        <Button onClick={() => void exportMoneyCsv()}>
          <IconDownload size={16} /> Spending &amp; income as CSV
        </Button>
        <Button onClick={() => void exportAccountsCsv()}>
          <IconDownload size={16} /> Bank statements as CSV
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
              if (!confirm(syncConfigured ? "Delete ALL your data, here and in your cloud account? Download a backup first." : "Delete ALL instruments, transactions and prices from this browser? Download a backup first.")) return;
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

function saveFile(body: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Spreadsheet-friendly export of every transaction (re-importable via the CSV importer). */
async function exportTxnsCsv() {
  const [instruments, txns] = await Promise.all([db.instruments.toArray(), db.txns.toArray()]);
  const byId = new Map(instruments.map((i) => [i.id, i]));
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["Date", "Name", "Kind", "Symbol", "AMFI code", "Type", "Qty", "Price", "Amount", "Charges", "TDS", "Notes"].join(",")];
  for (const t of [...txns].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const i = byId.get(t.instrumentId);
    const d = i?.details;
    const symbol = d && (d.kind === "stock" || d.kind === "etf" || d.kind === "gold") ? (d.symbol ?? "") : "";
    const amfi = d?.kind === "mf" ? d.amfiCode : "";
    rows.push(
      [t.date, i?.name ?? "", i?.kind ?? "", symbol, amfi, t.type, t.qty, t.price, t.amount / 100, t.charges ? t.charges / 100 : undefined, t.tds ? t.tds / 100 : undefined, t.notes]
        .map(esc)
        .join(","),
    );
  }
  saveFile(rows.join("\n"), `kaasu-transactions-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ?`"${s.replace(/"/g, '""')}"` : s;
};

/** Every spend and income entry, with the account it went through. */
async function exportMoneyCsv() {
  const [cash, instruments] = await Promise.all([db.cash.toArray(), db.instruments.toArray()]);
  const byId = new Map(instruments.map((i) => [i.id, i]));
  const rows = [["Date", "Type", "Category", "Amount", "Account", "Note"].join(",")];
  for (const e of [...cash].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    rows.push([e.date, e.kind, categoryOf(e.category).label, (e.kind === "income" ? e.amount : -e.amount) / 100, byId.get(e.accountId ?? "")?.name ?? "", e.note].map(csvCell).join(","));
  }
  saveFile(rows.join("\n"), `kaasu-money-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
}

/** Every bank account's statement: each rupee in or out, what it was for, and the running balance. */
async function exportAccountsCsv() {
  const [txns, cash, instruments] = await Promise.all([db.txns.toArray(), db.cash.toArray(), db.instruments.toArray()]);
  const instrumentById = new Map(instruments.map((i) => [i.id, i]));
  const rows = [["Account", "Date", "What", "Detail", "Money in", "Money out", "Balance"].join(",")];
  for (const acc of activeAccounts(instruments)) {
    for (const r of accountLedger(acc.id, { txns, cash, instrumentById }).reverse()) {
      rows.push([acc.name, r.date, r.label, r.sub, r.delta > 0 ? r.delta / 100 : undefined, r.delta < 0 ? -r.delta / 100 : undefined, r.balance / 100].map(csvCell).join(","));
    }
  }
  saveFile(rows.join("\n"), `kaasu-accounts-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
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
