# stamperCapital: project brief

Joshua's personal investing app. Replaces an Excel-VBA + Power BI setup: Alpha Vantage data in
Supabase, a value screener with drill-down per stock, corrections that survive refreshes, shared
with a few friends and family. Final buy/sell timing is done outside this system in Thinkorswim.

## Where things are
- Repo: github.com/joshup24/stamperCapital (this folder). Database: Supabase project `nxanjjiwviumkzjrqmbx`
  (https://nxanjjiwviumkzjrqmbx.supabase.co), currently on the Free plan; Pro ($25/mo) is approved and
  should be bought before the full data load or any real sharing (Free projects pause after 7 idle days).
- `supabase/migrations/*.sql` is the schema, applied by hand in the Supabase SQL Editor in filename
  order (core, statement_tables [generated], statement_logic, valuation, quote_probe). `README.md` explains the model.
- `ingest/av_ingest.py` pulls Alpha Vantage into the raw tables. Run by `.github/workflows/ingest.yml`:
  by hand, and on a schedule Tue-Sat 11:00 UTC (3am Pacific). Secrets live only in GitHub Actions
  (`ALPHAVANTAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`) plus variable `AV_CALLS_PER_MINUTE=70`.

## What the web app reads (never the raw tables, never with the secret key)
Views, all `security_invoker`, readable by signed-in members only:
- `valuation_latest` is the screener row per ticker (value per share on last full year and on trailing
  four quarters, price, possible gain, multiple and its source, `fx_missing`, `any_overridden`).
- `valuation_annual` is the per-year valuation history (the report's Valuation page).
- `income_statement`, `balance_sheet`, `cash_flow`, `earnings` are raw plus corrections, with `currency`
  and `fx_rate` (USD per unit). Multiply money columns by `fx_rate`; never share counts or surprise %.
- `price_monthly_effective`, `company_overview`, `quote_latest`, `ticker`, `ticker_group` (groups like
  MYERS = his holdings, PRECAST, METALS), `industry_catalog`, `ticker_multiple`, `override_review`, `currency_gaps`.
Writes the app may do (editors only, enforced by RLS): insert into `statement_override` / `price_override`
(needs a reason; the field is the column name, e.g. `total_revenue`; retire by setting `retired_at`),
edit `ticker.category` / `ticker.multiple_override`, `multiple_rule`, `valuation_param`, `ticker_group`.
Auth: Supabase Auth, invite-only (public sign-ups switched off). `app_user.role` is viewer/editor/admin;
new logins default to viewer, so the first admin must be set by SQL. The browser uses the PUBLISHABLE key only.

## The valuation model (Joshua's own method)
value/share = multiple x net income/share + multiple x dividends/share + value of assets/share, where
value of assets = total assets - (intangibles + goodwill) - 50% of PP&E - total liabilities. GAAP net income,
never adjusted EPS; EBITDA and cash flow are reference only. Shares = balance-sheet shares. Default multiple 11,
overridable by ticker, then category (his own buckets: likes defense, insurance, commodities; dislikes autos),
then industry, then sector. Balance sheet = latest quarter; income and dividends = last full year or trailing
four quarters. Missing data stays missing (the old model turned "None" into 0 and that hid problems).

## Decisions made
- Custom React app on Vercel (free `*.vercel.app` address is fine; custom domain optional later), not Base44.
  He was still looking into Vercel; confirm before assuming. Node.js is needed (`winget install -e --id OpenJS.NodeJS.LTS`).
- Symbols use Alpha Vantage spelling with a dash (BRK-B). Thinkorswim wants BRK/B: a display-symbol column is possible later.
- Version 1 of the app: login; screener table (filter by group, sector, industry; sort on value vs price);
  stock page with charts (price vs value over time, revenue and earnings, dividends, balance sheet, ratios);
  inline correction of a bad number with a reason; admin screens for categories and multiples.

## Open items (data side, handled in the ingest thread)
- Quote timing: `quote_probe` experiment measures when Alpha Vantage's quote is final after the close. His plan has
  75 calls/min, no daily limit, and 15-minute delayed US data (`entitlement=delayed`); if that is final by ~4:30pm ET,
  add a late-afternoon quote refresh and use it.
- FX history: Alpha Vantage FX_MONTHLY is short for CAD, CHF, MXN, ILS (16-39 months); the free ECB-based
  Frankfurter API (api.frankfurter.dev) has daily history from 1999 and is the planned fallback. NVO (DKK) has no rate yet.
- Tickers with no Alpha Vantage data (e.g. NSRGY) need another source or manual entry. Semiannual reporters (BTI)
  get no trailing-four-quarters value. Insurers' GAAP income swings on investment gains; he is the judge of that.
- Still to load: his real universe (~730 tickers from his OneDrive file names) plus groups from `equity-groups.xlsm`.
- Missing from the Power BI port: the Equity Summary's Alert, Mult-Cust and VoI measures (need his DAX).
- Later: per-user watchlists, notes and saved screens; data-quality flags; quarterly projections; rotate the Alpha Vantage key
  (it was pasted in chat and sits in plain text in an OneDrive workbook).

## Working with Joshua
- He is not a developer; give exact click paths, one step at a time, and wait for his confirmation. Keep answers short.
- Never ask him to paste keys in chat. Never commit secrets. Run a secret scan before committing.
- Windows + PowerShell. A session started before an install needs `$env:Path` refreshed from Machine+User. The shell's
  safety check blocks `Remove-Item` when mixed into a long command: run cleanup as its own call with a literal path.
- Verify before claiming: tests run with stubbed network and database, SQL syntax checked with the `pglast` parser in a
  throwaway venv. The database logic has only been exercised by the real runs so far.
