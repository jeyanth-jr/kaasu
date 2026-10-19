import { motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTour } from "../App";
import { Badge, Button, Callout, Card, IconTile, PageHeader } from "../ui/components";
import { IconBanknote, IconCheck, IconDownload, IconFlag, IconPlus, IconReceiptPlain, IconRepeat, IconUpload } from "../ui/icons";
import { TEMPLATE } from "../ui/ImportCsv";

export function HelpPage() {
  const { openTour } = useTour();
  const navigate = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    const id = hash.replace("#", "");
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [hash]);

  return (
    <>
      <PageHeader
        title="Help"
        sub="Getting started, and how to bring your data in."
        action={
          <Button onClick={openTour}>
            <IconFlag size={15} /> Replay the tour
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <Card title="Set up in this order" icon={<IconCheck size={15} />}>
          <ol className="flex flex-col gap-3">
            {[
              ["Payday and budgets", "Money → set your salary day, then your category budgets.", "/money"],
              ["Your bank accounts", "Accounts → Add account for each one, with today's balance. Every spend, income and investment then asks which account, and keeps its balance true.", "/accounts"],
              ["Your goals", "Goals → set a target and date for a trip, a phone, a home. Kaasu shows the monthly amount to put aside.", "/goals"],
              ["Your investments", "Import a spreadsheet (below) or add each one with the + button.", "/settings#import"],
              ["Link prices", "Holdings → \"Link price sources\" for anything without a symbol or fund code.", "/holdings"],
              ["Monthly plans", "Plans → SIPs, RDs, gold chits and EMIs, with durations.", "/plans"],
              ["Spending history", "Import a bank statement so budgets and safe-to-spend have real data.", "/money?statement=1"],
            ].map(([t, d, to], i) => (
              <li key={t as string} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-extrabold text-accent num">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{t}</div>
                  <div className="text-sm text-muted">{d}</div>
                </div>
                {to && (
                  <Button size="sm" variant="ghost" onClick={() => navigate(to as string)}>
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <div id="import" className="scroll-mt-20">
          <h2 className="display mb-3 text-2xl font-extrabold">Bring your data in</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Method
              icon={<IconUpload size={20} />}
              color="var(--c-debt)"
              title="A spreadsheet of holdings or trades"
              badge="CSV"
              action={
                <Button variant="primary" size="sm" onClick={() => navigate("/settings#import")}>
                  Import a spreadsheet
                </Button>
              }
            >
              <Steps
                steps={[
                  "Save your sheet as CSV (in Excel or Google Sheets: File → Download → CSV).",
                  "Settings → Import from CSV → choose the file.",
                  "Check the header row and the column mapping. Kaasu guesses it. Pick your date format (India is Day/Month/Year).",
                  "Review the preview: every row shows new or existing, and skipped rows say why. Then Import.",
                ]}
              />
              <Details title="Columns Kaasu understands">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <b>Date</b>, <b>Name</b> (or symbol), <b>Quantity</b>, and <b>Price</b> or <b>Amount</b>. Those four are enough.
                  </li>
                  <li>
                    Optional: <b>Symbol</b>, <b>AMFI code</b>, <b>Instrument type</b> (stock, ETF, mf, gold…), <b>Transaction type</b> (buy, sell, SIP, dividend, bonus, split…) and <b>Charges</b>.
                  </li>
                  <li>
                    A holdings sheet with an <b>average price</b> works: each row becomes one buy on its date. Without a type column, rows are treated as buys.
                  </li>
                  <li>
                    A row with only a heading, like <i>Mutual funds</i> or <i>RD</i>, sets the type for the rows under it.
                  </li>
                  <li>Amounts can look like 1,23,456, ₹2,500, (1,200) or 1.5L.</li>
                </ul>
              </Details>
              <Details title="After importing">
                <ul className="list-disc space-y-1 pl-5">
                  <li>Stocks with a clear name get their NSE symbol automatically. Funds and misspelt names go to <b>Holdings → Link price sources</b>, where you pick the right match and compare its price to your average cost.</li>
                  <li>FDs and RDs imported from a sheet need their rate and dates filled in on the holding page, or recreate them under Plans.</li>
                  <li>Not happy with it? <b>Transactions</b> shows the import with an <b>Undo</b> button that removes the rows and the holdings it created.</li>
                </ul>
              </Details>
              <a
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
                download="kaasu-import-template.csv"
              >
                <IconDownload size={15} /> Download an example file
              </a>
            </Method>

            <Method
              icon={<IconReceiptPlain size={20} />}
              color="var(--c-equity)"
              title="A bank statement"
              badge="CSV"
              action={
                <Button variant="primary" size="sm" onClick={() => navigate("/money?statement=1")}>
                  Import a statement
                </Button>
              }
            >
              <Steps
                steps={[
                  "In net banking, open Account statement and download it as CSV. (If you only get Excel, open it and save as CSV. PDF statements aren't supported.)",
                  "Money → Statement → choose the file.",
                  "Each line is sorted into a category. Change any category, or untick lines you don't want.",
                  "Optional: pick the account so its balance updates too. Then Import.",
                ]}
              />
              <Details title="Good to know">
                <ul className="list-disc space-y-1 pl-5">
                  <li>Works with the usual layouts: separate Withdrawal and Deposit columns, a signed Amount column, or Amount with Dr/Cr.</li>
                  <li>Importing the same statement twice is safe: lines you already imported are skipped.</li>
                  <li>Salary credits are recognised, so payday and your income for the month fill in.</li>
                  <li>Leave "update its balance" off if you already record that account's balance another way.</li>
                </ul>
              </Details>
            </Method>

            <Method
              icon={<IconPlus size={20} />}
              color="var(--accent)"
              title="Add things by hand"
              badge="Anytime"
              action={
                <Button size="sm" onClick={() => navigate("/plans")}>
                  Open Plans
                </Button>
              }
            >
              <Steps
                steps={[
                  "Tap + (bottom of the phone screen, or the Add button on desktop) → Investment.",
                  "Type a stock name or symbol, or a fund name. Pick the match and enter quantity and price. Kaasu remembers it for next time.",
                  "For SIPs, RDs, gold chits and loans, use Plans → New plan: you enter the amount, day and duration once.",
                ]}
              />
            </Method>

            <Method
              icon={<IconBanknote size={20} />}
              color="var(--gain)"
              title="Restore a Kaasu backup"
              badge="JSON"
              action={
                <Button size="sm" onClick={() => navigate("/settings#backup")}>
                  Open backups
                </Button>
              }
            >
              <Steps steps={["Settings → Backup & restore → Restore from file.", "Choose a backup you downloaded earlier (if it is encrypted, you'll be asked for the passphrase).", "Restoring replaces what's in your account, so download a fresh backup first if unsure."]} />
            </Method>
          </div>

          <div className="mt-4">
            <Callout tone="neutral" title="Not supported yet">
              CAS (CAMS/KFintech) PDF statements and bank PDF statements. If you can export a CSV or Excel version, use that.
            </Callout>
          </div>
        </div>

        <Card title="Common problems" icon={<IconRepeat size={15} />}>
          <div className="flex flex-col divide-y divide-line">
            <Faq q="Some rows were skipped during import">
              The preview lists each skipped row with the reason, such as an unrecognised date, a missing quantity, or no price or amount. Fix those cells in your sheet and import again, or add them by hand. Try the other date format if many dates are rejected.
            </Faq>
            <Faq q={'A holding shows "No price yet" or a stale price'}>
              Prices need a stock symbol or a fund's AMFI code. Use <Link to="/holdings?link=1" className="font-semibold text-accent">Link price sources</Link>, or set a price by hand on the holding. Every price shows its date and where it came from.
            </Faq>
            <Faq q="My numbers look off after importing">
              A holdings sheet records one buy per row at the average price on that date, so tax lots and XIRR start from those dates. For exact lots, import your real trade history instead.
            </Faq>
            <Faq q="Can Kaasu record my RD, bond and SIP payments for me?">
              RDs and bonds, yes: pick the bank account on the RD (debits and maturity) or on the bond (coupons and maturity) and Kaasu records each payment on its date and moves that account's balance. It starts from the day you pick the account and never adds the same payment twice. For SIPs it asks "have you paid?" after the due date; you give the average NAV and it records the units and the debit. RD maturity uses an estimate, so edit it if your bank paid a different amount.
            </Faq>
            <Faq q="How do I stop a SIP or end a loan?">
              Plans → open the SIP and choose Stop SIP, or Edit a loan to change or delete it. Past instalments stay on record.
            </Faq>
            <Faq q="Is my data private, and can I leave?">
              It is stored in your private account and only your login can read it. It isn't end-to-end encrypted, which the Privacy Policy explains. You can download everything from Settings → Backup, or delete your account and all data from Settings → Account.
            </Faq>
          </div>
        </Card>

        <p className="text-xs text-muted">
          <Link to="/privacy" className="font-semibold text-accent">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link to="/terms" className="font-semibold text-accent">
            Terms
          </Link>
        </p>
      </div>
    </>
  );
}

function Method({ icon, color, title, badge, action, children }: { icon: ReactNode; color: string; title: string; badge: string; action: ReactNode; children: ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-30px" }} className="flex flex-col gap-3 rounded-3xl border border-line/80 bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        <IconTile color={color} className="h-11 w-11">
          {icon}
        </IconTile>
        <h3 className="min-w-0 flex-1 text-[15px] font-bold">{title}</h3>
        <Badge>{badge}</Badge>
      </div>
      {children}
      <div className="mt-auto pt-1">{action}</div>
    </motion.section>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2.5 text-sm">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sunken text-[11px] font-bold text-muted num">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line px-3.5 py-2.5 text-sm">
      <summary className="cursor-pointer font-semibold text-muted group-open:text-ink">{title}</summary>
      <div className="mt-2 text-muted">{children}</div>
    </details>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group py-3">
      <summary className="cursor-pointer text-sm font-bold">{q}</summary>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </details>
  );
}
