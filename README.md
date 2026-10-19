# Kaasu (காசு)

A local-first portfolio tracker for an Indian retail investor. It covers stocks, ETFs, mutual funds, RDs, FDs, bonds/NCDs, gold, cash and "commitments outside the portfolio". There's no login and no cloud: your data lives in your browser's IndexedDB.

- **Transactions, not balances.** Every buy, SIP, RD instalment, interest payout and redemption is a dated transaction. Holdings, average cost, P/L and XIRR are derived from them using FIFO lots.
- **Dashboard:** net worth, invested vs current value, today's change, overall XIRR, a net-worth-over-time chart, the emergency-fund meter, the next 90 days of cash flows, and alerts.
- **Allocation:** your current mix vs target bands, and how to split new money so you rebalance without selling. Also an equity breakdown by segment, sector and type, plus clutter and concentration flags with fund look-through (paste a fund's top holdings each month).
- **Tax (India, new regime):** per-lot holding days and the date each lot turns long-term. Unrealised STCG/LTCG split, realised gains this FY, remaining LTCG exemption, a FIFO-aware zero-tax harvest helper, and lots turning long-term soon. Every rate and threshold is editable in one place.
- **Calendar:** RD/FD/bond maturities, coupons, SIP dates, commitments and EMI end dates, plus a monthly plan comparing planned vs actually invested.
- **Import/export:** CSV import with a column-mapping screen, full JSON backup and restore (optionally encrypted), and a transactions CSV export.
- **Prices:** AMFI's daily NAV file for mutual funds, and Google Finance (or Yahoo Finance, as fallback) for NSE/BSE stocks and ETFs, both through a tiny local proxy. Manual prices always work. A price is never shown without its date and source.
- Light and dark themes, works on a phone (bottom tabs), installable as a PWA, and a privacy mode that blurs every amount.

> Kaasu is a personal tracker, not investment or tax advice.

## Run it locally

You need Node.js 22 or newer (see `.nvmrc`).

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run dev` starts two processes:

| Process | Port | What it does |
| --- | --- | --- |
| Vite (the app) | 5173 | Serves the UI. Requests to `/api/*` are forwarded to the proxy. |
| Price proxy (`server/index.ts`) | 8787, localhost only | Fetches AMFI NAVs and Google/Yahoo quotes. Stores nothing about your portfolio. |

Click **Load sample data** to explore with a clearly labelled fictional portfolio, and **Clear sample data** (Dashboard or Settings) to remove it. Your own entries are never touched.

### On your phone

Vite listens on your LAN. `npm run dev` prints a `Network:` URL such as `http://192.168.1.20:5173`. Open it on a phone on the same Wi-Fi. The phone talks to Vite, which forwards price requests to the proxy on your computer.

Note that **each browser has its own data**. The phone's browser does not share data with your laptop's browser. To move data between them, use Backup → Restore.

### Production build

```bash
npm start        # builds, then serves dist/ on :4173 with the proxy
```

Other scripts: `npm test` runs the unit tests, `npm run typecheck`, `npm run build`, and `npm run proxy` runs just the price proxy.

## Back up your data (important)

Everything is stored in this browser's IndexedDB. Clearing site data, uninstalling the browser or a private window will lose it. Kaasu asks the browser for persistent storage and reminds you when your last backup is more than 14 days old, but backups are your safety net.

- **Back up:** Settings → Backup & restore → **Download backup**. You get a `kaasu-backup-YYYY-MM-DD-HH-MM.json` file. Enter a passphrase first to encrypt it in the browser (AES-256-GCM, PBKDF2 key). Without the passphrase it can't be restored.
- **Restore:** Settings → **Restore from file**. The file is validated before anything changes: a corrupt or non-Kaasu file is rejected with a reason, and a valid one replaces current data in one atomic transaction.
- **Spreadsheet copy:** **Transactions as CSV** exports every transaction. The CSV importer can read it back.

Store backups somewhere private: they contain your full portfolio. `*.csv`, `*.pdf` and `kaasu-backup-*.json` are git-ignored so personal files don't land in the repo by accident.

## Importing your spreadsheet

Settings → Import from CSV. Save your sheet as CSV, choose the file, then:

1. Pick the header row and map columns (date, name, symbol, AMFI code, type, quantity, price, amount, charges). Kaasu guesses from header names and prefers "Avg Price" over "Current Price".
2. Dates default to Indian D/M/YYYY (`8/4/2025` is 8 April). Amounts accept `1,23,456`, `(1,200)`, `₹2,500` and `1.5L`.
3. A row with only a name, such as `Mutual funds`, `RD`, `Deposits` or `Gold Investments`, is treated as a section heading and sets the instrument type of the rows below it.
4. Preview every row: each is marked existing or new, and skipped rows show the reason. Then import.
5. Each import can be undone from Transactions. Undo removes its transactions and the holdings it created.

A holdings-style sheet (one row per position with an average price) imports as one buy per row. Deposits imported from a sheet need their rate and dates filled in afterwards on the holding page.

CAS PDF import is not implemented yet (see roadmap). For now, export your CAS transactions to CSV.

## How the numbers work

- **Money** is stored as integer paise. Quantities are rounded to 4 decimals. Dates are plain `YYYY-MM-DD` calendar dates.
- **FIFO:** sells consume the oldest lots first, as depositories do. Buy charges add to cost and sell charges reduce proceeds. Bonus units are zero-cost lots dated on allotment. Splits rescale open lots. Overselling is flagged and never silently absorbed.
- **XIRR:** Excel-compatible (actual/365). Newton's method with a bisection fallback. Spans under 30 days aren't annualised. The portfolio XIRR excludes cash and commitments.
- **Deposits:** RD/FD values are quarterly-compounded accrual estimates. "If broken today" applies the premature-withdrawal penalty to the rate. The emergency fund's second layer uses that after-penalty value.
- **Commitments** (e.g. a jewellery savings plan for a family member) count as monthly outflows. They are excluded from net worth and allocation unless you switch them on.
- **Allocation** leaves instant emergency cash out by default. Rebalancing aims at band midpoints and funds deficits with new money first. A band with a 0% minimum is a cap, never a buy target.

### Tax rules (Settings → Tax constants)

The defaults follow Budget 2024, effective 23 July 2024:

| Asset | Long-term after | STCG | LTCG |
| --- | --- | --- | --- |
| Listed equity, equity funds/ETFs | more than 12 months | 20% | 12.5% above ₹1.25 lakh per FY |
| Gold ETFs, listed bonds | more than 12 months | slab | 12.5% |
| Physical gold, unlisted bonds | more than 24 months | slab | 12.5% |
| Debt funds bought on or after 1 Apr 2023, interest | never | slab | — |

"More than 12 months" means a lot bought on 15 Jan 2025 is long-term from 16 Jan 2026. Intra-year set-off works like this:

- Short-term losses offset any gains, highest rate first.
- Long-term losses offset only long-term gains.
- Non-exempt long-term gains are offset before equity LTCG, which keeps its exemption.

The 4% cess is included.

**Not modelled:**

- Surcharge
- Carried-forward losses from earlier years
- 31 Jan 2018 grandfathering
- Adjusting STCG against the basic exemption limit

The harvest helper respects FIFO: it never suggests a sale that would first force a short-term gain.

## Prices

- **Mutual funds:** `portal.amfiindia.com/spages/NAVAll.txt`, fetched by the proxy, parsed from its header row (AMFI has changed columns before) and cached on disk for the IST day in `.cache/`.
- **Stocks, ETFs and gold ETFs:** Google Finance by default, the same data `GOOGLEFINANCE()` uses in Sheets. Google has no public API, so the proxy reads the quote page (`google.com/finance/quote/INFY:NSE`) and takes the price, previous close and trade time for exactly the requested symbol. Related stocks on the page are never used. On BSE, Google needs the numeric scrip code (`500325`, not `RELIANCE`).
- **Fallback:** if Google can't price a symbol, Yahoo Finance's public chart endpoint (`SYMBOL.NS` or `.BO`) is tried, and vice versa if you choose Yahoo in Settings → Prices. Quotes are cached for 60 seconds. Neither source is official and either may change. If both fail, the holding says so and you enter a manual price.
- **Physical gold:** either a manual price per gram, or derived from a gold ETF's price ÷ grams per unit (Settings → Prices).
- Refreshing prices never overwrites sample holdings, which keep their sample prices.

## Project layout

```
server/            price proxy (Express) + AMFI parser (tested)
src/domain/        pure TypeScript: types, money, dates, XIRR, FIFO lots, tax, allocation,
                   equity analysis, calendar/plan, CSV parsing  (all unit-tested)
src/db/            Dexie schema, backup/restore (+ encryption), sample data
src/prices/        client for the proxy
src/ui/            shared components, data provider, add-transaction sheet, CSV importer
src/pages/         Dashboard, Holdings (+ detail), Transactions, Allocation, Tax, Calendar, Settings
```

Domain code has no React or IndexedDB dependency. Everything on screen is derived from transactions, prices and settings in one place (`src/ui/data.tsx` → `buildPortfolio`).

## Tests

`npm test` runs 75 tests:

- **XIRR:** the Excel reference case, leap years, SIPs, extreme rates.
- **FIFO:** partial lots, charges, splits/bonus, fractional units, same-day ordering, oversell.
- **Holding period and tax:** month-end and leap-day edges, exemption, set-off order, cess, harvest helper.
- **Domain logic:** allocation and rebalancing, look-through concentration, RD maturity, calendar, monthly plan.
- **CSV and price parsing:** both the old 6-column and new 8-column AMFI layouts, and Google Finance quote pages (exact symbol only, BSE codes, `M&M`).
- **Storage:** sample data, backup round-trip and corruption checks, encryption, import undo.

## Roadmap

- CAS (CAMS/KFintech) PDF import
- Historical NAV backfill for SIPs entered without a NAV
- Optional sync between devices through an encrypted file in a folder you choose
