"""Pull Alpha Vantage data and upsert it into the Supabase raw tables.

Never writes to statement_value_override, so corrections survive every refresh.

Usage:
  python ingest/av_ingest.py                          # all active tickers, all jobs
  python ingest/av_ingest.py AAPL MSFT                # specific tickers (added to universe if new)
  python ingest/av_ingest.py --only prices,quote      # subset of jobs
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

AV_URL = "https://www.alphavantage.co/query"
AV_KEY = os.environ["ALPHAVANTAGE_API_KEY"]
CALLS_PER_MINUTE = float(os.getenv("AV_CALLS_PER_MINUTE", "5"))
BATCH = 500

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])


class AVLimitError(Exception):
    """Alpha Vantage refused the call (daily quota / plan limit). Stop the run."""


class SkipSymbol(Exception):
    """Nothing usable for this symbol (ETF, delisted...). Skip its remaining jobs."""


# The per-minute burst message looks like "...contact premium@alphavantage.co if you
# are targeting a higher API call volume". Waiting a few seconds clears it.
BURST_HINTS = ("call volume", "per minute", "spreading out")
BURST_WAIT_SECONDS = 15
BURST_RETRIES = 6

_last_call = 0.0
api_calls = 0


def now():
    return datetime.now(timezone.utc).isoformat()


def norm(symbol):
    """Alpha Vantage wants BRK-B, not BRK.B."""
    return symbol.strip().upper().replace(".", "-")


def num(v):
    """AV sends numbers as strings, with 'None', '-', '1.2%' etc. Returns a string
    so Postgres numeric keeps full precision."""
    if v is None:
        return None
    s = str(v).strip().rstrip("%").replace(",", "")
    if s in ("", "None", "-", "N/A"):
        return None
    try:
        return str(Decimal(s))
    except InvalidOperation:
        return None


def day(v):
    return None if not v or v == "None" else v


def av(function, key, **params):
    """Call Alpha Vantage. `key` labels the cached payload and defaults to symbol=key."""
    global _last_call, api_calls
    params = params or {"symbol": key}

    for attempt in range(BURST_RETRIES + 1):
        wait = 60 / CALLS_PER_MINUTE - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()

        r = requests.get(AV_URL, params={"function": function, **params, "apikey": AV_KEY}, timeout=60)
        api_calls += 1
        r.raise_for_status()
        data = r.json()

        msg = data.get("Note") or data.get("Information")
        if not msg:
            break
        if attempt < BURST_RETRIES and any(h in msg.lower() for h in BURST_HINTS):
            print(f"burst limit, waiting {BURST_WAIT_SECONDS}s ({attempt + 1}/{BURST_RETRIES})")
            time.sleep(BURST_WAIT_SECONDS)
            continue
        raise AVLimitError(msg)

    if "Error Message" in data:
        raise ValueError(data["Error Message"])

    sb.table("api_payload").upsert(
        {"symbol": key, "function": function, "payload": data, "fetched_at": now()}
    ).execute()
    return data


def upsert(table, rows, on_conflict):
    for i in range(0, len(rows), BATCH):
        sb.table(table).upsert(rows[i:i + BATCH], on_conflict=on_conflict).execute()


# ---------------------------------------------------------------------------
# Statements (income / balance / cashflow / earnings) -> long format
# ---------------------------------------------------------------------------
PERIOD_FIELDS = {"fiscalDateEnding", "reportedCurrency", "reportedDate", "reportTime"}
PERIOD_KEY = "symbol,statement,period,fiscal_date_ending"


def write_statement(symbol, statement, reports_by_period):
    ts = now()
    periods, values = {}, {}  # dicts dedupe: AV occasionally repeats a fiscal date
    for period, reports in reports_by_period.items():
        for rep in reports:
            fde = day(rep.get("fiscalDateEnding"))
            if not fde:
                continue
            key = (symbol, statement, period, fde)
            periods[key] = {
                "symbol": symbol, "statement": statement, "period": period,
                "fiscal_date_ending": fde,
                "reported_date": day(rep.get("reportedDate")),
                "report_time": rep.get("reportTime"),
                # AV sends the text "None" for ~3% of tickers, even big US names
                "reported_currency": day(rep.get("reportedCurrency")),
                "fetched_at": ts,
            }
            for field, v in rep.items():
                if field in PERIOD_FIELDS:
                    continue
                values[key + (field,)] = {
                    "symbol": symbol, "statement": statement, "period": period,
                    "fiscal_date_ending": fde, "field": field, "value": num(v), "fetched_at": ts,
                }
    upsert("statement_period", list(periods.values()), PERIOD_KEY)
    upsert("statement_value_raw", list(values.values()), PERIOD_KEY + ",field")


def ingest_statement(symbol, function, statement):
    d = av(function, symbol)
    write_statement(symbol, statement, {
        "annual": d.get("annualReports", []),
        "quarterly": d.get("quarterlyReports", []),
    })


def ingest_earnings(symbol):
    d = av("EARNINGS", symbol)
    write_statement(symbol, "earnings", {
        "annual": d.get("annualEarnings", []),
        "quarterly": d.get("quarterlyEarnings", []),
    })


# ---------------------------------------------------------------------------
# Prices, overview, quote
# ---------------------------------------------------------------------------
def ingest_prices(symbol):
    series = av("TIME_SERIES_MONTHLY_ADJUSTED", symbol).get("Monthly Adjusted Time Series", {})
    ts = now()
    rows = [{
        "symbol": symbol, "month_end": d,
        "open": num(v.get("1. open")), "high": num(v.get("2. high")),
        "low": num(v.get("3. low")), "close": num(v.get("4. close")),
        "adjusted_close": num(v.get("5. adjusted close")), "volume": num(v.get("6. volume")),
        "dividend_amount": num(v.get("7. dividend amount")), "fetched_at": ts,
    } for d, v in series.items()]
    upsert("price_monthly", rows, "symbol,month_end")


def ingest_overview(symbol):
    d = av("OVERVIEW", symbol)
    if not d.get("Symbol"):  # ETFs and unknown symbols come back empty
        raise SkipSymbol("no overview data (ETF or unknown symbol)")
    sb.table("company_overview").upsert({
        "symbol": symbol, "name": d.get("Name"), "asset_type": d.get("AssetType"),
        "exchange": d.get("Exchange"), "currency": d.get("Currency"), "country": d.get("Country"),
        "sector": d.get("Sector"), "industry": d.get("Industry"),
        "fiscal_year_end": d.get("FiscalYearEnd"), "latest_quarter": day(d.get("LatestQuarter")),
        "market_cap": num(d.get("MarketCapitalization")),
        "shares_outstanding": num(d.get("SharesOutstanding")),
        "data": d, "fetched_at": now(),
    }).execute()


def ingest_quote(symbol):
    q = av("GLOBAL_QUOTE", symbol).get("Global Quote") or {}
    if not q:
        return
    sb.table("quote_latest").upsert({
        "symbol": symbol,
        "open": num(q.get("02. open")), "high": num(q.get("03. high")), "low": num(q.get("04. low")),
        "price": num(q.get("05. price")), "volume": num(q.get("06. volume")),
        "latest_trading_day": day(q.get("07. latest trading day")),
        "previous_close": num(q.get("08. previous close")),
        "change": num(q.get("09. change")), "change_percent": num(q.get("10. change percent")),
        "fetched_at": now(),
    }).execute()


def ingest_fx():
    """Monthly close to USD (USD per 1 unit) for every active non-USD row in `currency`."""
    rows = sb.table("currency").select("currency").eq("is_active", True).execute().data
    ts = now()
    for ccy in sorted({r["currency"] for r in rows} - {"USD"}):
        d = av("FX_MONTHLY", f"{ccy}/USD", from_symbol=ccy, to_symbol="USD")
        series = d.get("Time Series FX (Monthly)", {})
        upsert("fx_rate_monthly", [
            {"currency": ccy, "month_end": dt, "rate": num(v.get("4. close")), "fetched_at": ts}
            for dt, v in series.items()
        ], "currency,month_end")
        print(f"ok   {ccy}/USD  fx")


JOBS = {
    "overview": ingest_overview,
    "income": lambda s: ingest_statement(s, "INCOME_STATEMENT", "income"),
    "balance": lambda s: ingest_statement(s, "BALANCE_SHEET", "balance"),
    "cashflow": lambda s: ingest_statement(s, "CASH_FLOW", "cashflow"),
    "earnings": ingest_earnings,
    "prices": ingest_prices,
    "quote": ingest_quote,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols", nargs="*", help="tickers to load (default: all active)")
    ap.add_argument("--only", help="comma list of jobs: fx," + ",".join(JOBS))
    args = ap.parse_args()

    jobs = args.only.split(",") if args.only else ["fx"] + list(JOBS)
    unknown = [j for j in jobs if j != "fx" and j not in JOBS]
    if unknown:
        ap.error(f"unknown job(s): {', '.join(unknown)}")
    run_fx = "fx" in jobs
    # overview first, so a symbol with no data is skipped before spending more calls on it
    jobs = sorted((j for j in jobs if j != "fx"), key=list(JOBS).index)

    if args.symbols:
        symbols = [norm(s) for s in args.symbols]
        sb.table("ticker").upsert([{"symbol": s} for s in symbols],
                                  on_conflict="symbol", ignore_duplicates=True).execute()
    else:
        res = sb.table("ticker").select("symbol").eq("is_active", True).order("symbol").execute()
        symbols = [r["symbol"] for r in res.data]

    run = sb.table("ingest_run").insert(
        {"jobs": (["fx"] if run_fx else []) + jobs, "symbols": symbols}).execute().data[0]
    status, errors = "success", {}
    try:
        if run_fx:
            ingest_fx()
        for sym in (symbols if jobs else []):
            for job in jobs:
                try:
                    JOBS[job](sym)
                    print(f"ok   {sym:<8} {job}")
                except SkipSymbol as e:
                    print(f"skip {sym:<8} {e}")
                    break
                except AVLimitError:
                    raise
                except Exception as e:
                    errors[f"{sym}:{job}"] = str(e)
                    print(f"FAIL {sym:<8} {job}: {e}")
    except AVLimitError as e:
        status = "rate_limited"
        errors["_limit"] = str(e)
        print(f"Stopped by Alpha Vantage limit: {e}")
    except Exception as e:
        status = "failed"
        errors["_fatal"] = str(e)
        raise
    finally:
        if errors and status == "success":
            status = "partial"
        sb.table("ingest_run").update({
            "finished_at": now(), "status": status, "api_calls": api_calls, "errors": errors or None,
        }).eq("id", run["id"]).execute()
        print(f"Run {run['id']}: {status}, {api_calls} API calls, {len(errors)} errors")

    sys.exit(0 if status == "success" else 1)


if __name__ == "__main__":
    main()
