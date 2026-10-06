# stamperCapital

Personal investing application: Alpha Vantage data in Supabase, a value-based screener,
and corrections that survive every refresh.

## How it fits together

```
Alpha Vantage ──► ingest/av_ingest.py ──► Supabase Postgres ──► web app (later)
                  (GitHub Actions)         raw tables  (ingest writes these)
                                           overrides   (your corrections, ingest never touches)
                                           views       (raw + corrections, in USD, valuation)
```

| Folder | What |
|---|---|
| `supabase/migrations/` | The database. Run in filename order. |
| `ingest/` | Pulls Alpha Vantage into the raw tables. `columns.py` is generated. |
| `tools/gen_statement_tables.py` | Regenerates the statement tables and `ingest/columns.py` from real Alpha Vantage files. |
| `.github/workflows/ingest.yml` | Runs the ingest on GitHub (manual for now, schedule ready to enable). |

## Data model in one minute

- **Raw tables** (`income_statement_raw`, `balance_sheet_raw`, `cash_flow_raw`, `earnings_raw`, `price_monthly`)
  hold exactly what Alpha Vantage sent: one row per period, one typed column per field.
- **Corrections** go in `statement_override` / `price_override`. Each needs a reason, is
  retired rather than deleted, and records what Alpha Vantage said at the time.
  `override_review` flags any correction where Alpha Vantage later changed its number.
- **Views the app reads**: `income_statement`, `balance_sheet`, `cash_flow`, `earnings`,
  `price_monthly_effective` (raw + corrections, with currency and USD rate), then
  `valuation_annual` and `valuation_latest`.
- `statement_revision` logs every time Alpha Vantage changes a number it sent before.

## Valuation

`value/share = multiple × net income/share + multiple × dividends/share + value of assets/share`,
where value of assets = total assets − intangibles and goodwill − 50% of PP&E − total liabilities.
GAAP net income, everything in USD. Multiples default to 11 and can be set per category,
industry, sector or ticker (`multiple_rule`, `ticker.category`, `ticker.multiple_override`).

## Refresh

A run fetches only what is due: quotes daily, prices and overview monthly, statements only
after a company has reported (from Alpha Vantage's earnings calendar). Tickers Alpha Vantage
has no data for are marked `no_data` and skipped. Hitting the daily quota stops the run
cleanly and the next run continues.

```
python ingest/av_ingest.py                # everything due
python ingest/av_ingest.py AAPL MSFT      # these tickers, refetch everything
python ingest/av_ingest.py --only quote
```

Needs `ALPHAVANTAGE_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (see `.env.example`).
Keys live only in a local `.env` (git-ignored) and in GitHub Actions secrets, never in files.
