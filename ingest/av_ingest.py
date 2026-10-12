"""Pull Alpha Vantage data into Supabase.

Writes only the raw tables. Corrections (statement_override, price_override) are never
touched, so they survive every refresh.

A run fetches only what is due:
  quote      every run (one cheap call per ticker)
  prices     monthly bars, every 25 days
  overview   every 30 days
  statements only when the company has reported since the last fetch (EARNINGS_CALENDAR),
             never fetched, or the last fetch is over 120 days old
Tickers with no company data (ETFs, OTC ADRs...) are marked 'no_data': no statements, but they
still get quotes and prices, and the overview is rechecked monthly. An empty overview alone does
not decide it: one INCOME_STATEMENT call checks whether statements exist first.
A run that hits the daily quota stops cleanly and the next run picks up where it left off.
Any other failure is retried after 10s, 30s and 60s, then recorded and skipped (the next run
tries again, since nothing was marked done). Every retry and failure is also appended to
logs/ingest_errors.log.

Usage:
  python ingest/av_ingest.py                    # everything that is due, all active tickers
  python ingest/av_ingest.py --only quote       # chosen jobs: calendar,fx,overview,income,balance,cashflow,earnings,prices,quote
  python ingest/av_ingest.py AAPL MSFT          # only these tickers (added if new: a new ticker gets everything)
  python ingest/av_ingest.py --force            # ignore what is up to date (add tickers to limit it to those)
"""
import argparse
import csv
import io
import os
import sys
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from columns import STATEMENT_FIELDS

load_dotenv()

AV_URL = "https://www.alphavantage.co/query"
AV_KEY = os.environ["ALPHAVANTAGE_API_KEY"]
CALLS_PER_MINUTE = float(os.getenv("AV_CALLS_PER_MINUTE", "5"))
BATCH = 500   # rows per upsert request
PAGE = 1000   # rows per read request (PostgREST's default cap)

# Rate limit: never more than CALLS_PER_MINUTE calls in any rolling 60 seconds. Calls go out
# as fast as they come back until that count is used up, then the script waits for the
# oldest call to turn a minute old. If Alpha Vantage pushes back anyway (the message looks
# like "...contact premium@alphavantage.co if you are targeting a higher API call volume"),
# wait out the clock minute and start the count again.
BURST_HINTS = ("call volume", "per minute", "spreading out")
BURST_RETRIES = 6

# Any other failure (network error, timeout, bad reply, "Invalid API call", a failed database
# write...) is retried after each of these waits, in seconds, then recorded and skipped.
# Alpha Vantage's "Invalid API call. Please retry..." arrives in short bursts on its side
# (about 7% of statement calls in one big run), which is what this is for.
# Never retried: a daily quota / key / plan message, where waiting cannot help, and a
# normal skip such as an ETF with no company data.
RETRY_WAITS = (10, 30, 60)

# Every retry and failure is also appended here; the workflow uploads logs/ with each run.
LOG_PATH = Path(os.getenv("INGEST_LOG", "logs/ingest_errors.log"))

REFRESH_DAYS = {"overview": 30, "prices": 25}
STATEMENT_SAFETY_DAYS = 120   # re-pull statements this often even if no report was spotted
REPORT_LAG_DAYS = 3           # Alpha Vantage needs a few days to publish after a report

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])


class AVLimitError(Exception):
    """Alpha Vantage refused the call (daily quota / plan limit). Stop the run."""


class SkipSymbol(Exception):
    """Nothing usable for this symbol. Skip its remaining jobs."""


class NoFundamentals(SkipSymbol):
    """Alpha Vantage has no company data for this ticker (an ETF, an OTC ADR...). Statements
    are pointless, but prices and quotes often still work."""


_recent_calls = deque()  # monotonic times of the calls made in the last minute
api_calls = 0
ERRORS = {}


def log_event(kind, label, message):
    """Append one line to the error log, creating the folder if needed."""
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"{stamp} | {kind:<7} | {label} | {' '.join(str(message).split())}\n")
    except OSError:
        pass  # a full disk must not take the run down


def write_summary(status, started, tickers, jobs):
    """logs/ingest_summary.txt: how the run went, for the emailed report (tools/send_report.py)."""
    minutes = (datetime.now(timezone.utc) - started).total_seconds() / 60
    lines = [
        f"status: {status}",
        f"started: {started.isoformat(timespec='seconds')}",
        f"minutes: {minutes:.1f}",
        f"api_calls: {api_calls}",
        f"tickers: {tickers}",
        f"jobs: {', '.join(jobs)}",
        f"errors: {len(ERRORS)}",
    ] + [f"error: {key}: {' '.join(str(msg).split())}" for key, msg in ERRORS.items()]
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        (LOG_PATH.parent / "ingest_summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        pass


def with_retries(label, fn):
    """Run fn(). On ANY failure wait RETRY_WAITS in turn and try again, then raise the last
    error. A daily-quota / key / plan message (AVLimitError) and a normal skip (SkipSymbol)
    pass straight through."""
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            return fn()
        except (AVLimitError, SkipSymbol):
            raise
        except Exception as e:
            if attempt == len(RETRY_WAITS):
                log_event("FAILED", label, e)
                raise
            pause = RETRY_WAITS[attempt]
            log_event("RETRY", f"{label} (retry {attempt + 1}/{len(RETRY_WAITS)} in {pause}s)", e)
            print(f"retry {attempt + 1}/{len(RETRY_WAITS)} in {pause}s: {label}: {e}")
            time.sleep(pause)


def _wait_for_slot():
    """Allow at most CALLS_PER_MINUTE calls in any rolling 60 seconds: go freely up to the
    limit, then wait until the oldest of those calls is a minute old."""
    limit = max(1, int(CALLS_PER_MINUTE))
    while True:
        t = time.monotonic()
        while _recent_calls and t - _recent_calls[0] >= 60:
            _recent_calls.popleft()
        if len(_recent_calls) < limit:
            _recent_calls.append(t)
            return
        pause = 60 - (t - _recent_calls[0]) + 0.25
        print(f"{limit} calls in the last minute, waiting {pause:.0f}s")
        time.sleep(pause)


def _wait_for_next_minute():
    """Alpha Vantage pushed back: wait out the clock minute, then start the count afresh."""
    pause = 60 - (time.time() % 60) + 1
    print(f"Alpha Vantage pushed back, waiting {pause:.0f}s for the next minute")
    time.sleep(pause)
    _recent_calls.clear()


def now():
    return datetime.now(timezone.utc).isoformat()


def norm(symbol):
    """Alpha Vantage wants BRK-B, not BRK.B."""
    return symbol.strip().upper().replace(".", "-")


def num(v):
    """AV sends numbers as strings, with 'None', '-', '1.2%' etc. Returns a string so
    Postgres numeric keeps full precision; None means missing."""
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
    """Text or date field; AV's 'None' means missing."""
    return None if v is None or str(v).strip() in ("", "None", "-") else str(v).strip()


def month_of(date_str):
    return date_str[:8] + "01"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def upsert(table, rows, on_conflict):
    for i in range(0, len(rows), BATCH):
        sb.table(table).upsert(rows[i:i + BATCH], on_conflict=on_conflict).execute()


def fetch_all(table, columns, order, where=None):
    """Read every row, paging past the 1000-row cap."""
    rows, start = [], 0
    while True:
        q = sb.table(table).select(columns)
        if where:
            q = where(q)
        for col in order:
            q = q.order(col)
        batch = q.range(start, start + PAGE - 1).execute().data
        rows += batch
        if len(batch) < PAGE:
            return rows
        start += PAGE


def touch(symbol, dataset, latest=None):
    sb.table("ticker_refresh").upsert(
        {"symbol": symbol, "dataset": dataset, "last_success_at": now(), "latest_period_seen": latest},
        on_conflict="symbol,dataset",
    ).execute()


# ---------------------------------------------------------------------------
# Alpha Vantage
# ---------------------------------------------------------------------------
def _get(function, params):
    """One paced call. Returns parsed JSON, or the raw text for CSV endpoints."""
    global api_calls
    bursts = 0
    while True:  # every `continue` below spends a burst retry, so this always ends
        _wait_for_slot()
        r = requests.get(AV_URL, params={"function": function, **params, "apikey": AV_KEY}, timeout=60)
        api_calls += 1
        r.raise_for_status()

        if not r.text.lstrip().startswith("{"):
            return r.text  # CSV
        data = r.json()

        msg = data.get("Note") or data.get("Information")
        if msg:
            low = msg.lower()
            daily = "per day" in low or "daily" in low  # quota gone for the day: waiting cannot help
            if not daily and bursts < BURST_RETRIES and any(h in low for h in BURST_HINTS):
                bursts += 1
                _wait_for_next_minute()
                continue
            raise AVLimitError(msg)

        if "Error Message" in data:
            raise ValueError(data["Error Message"])  # with_retries decides whether to try again
        return data


def av(function, symbol, **params):
    return _get(function, params or {"symbol": symbol})


# ---------------------------------------------------------------------------
# Statements -> wide tables (one row per period, one column per AV field)
# ---------------------------------------------------------------------------
STATEMENTS = {
    # job: (AV function, statement key in columns.py, table, annual list, quarterly list)
    "income":   ("INCOME_STATEMENT", "income",   "income_statement_raw", "annualReports",  "quarterlyReports"),
    "balance":  ("BALANCE_SHEET",    "balance",  "balance_sheet_raw",    "annualReports",  "quarterlyReports"),
    "cashflow": ("CASH_FLOW",        "cashflow", "cash_flow_raw",        "annualReports",  "quarterlyReports"),
    "earnings": ("EARNINGS",         "earnings", "earnings_raw",         "annualEarnings", "quarterlyEarnings"),
}
TEXT_KEYS = {"reportedCurrency": "reported_currency", "reportedDate": "reported_date", "reportTime": "report_time"}


def statement_rows(symbol, job, data):
    """Turn one AV statement payload into table rows."""
    _, stmt, _, annual_key, quarterly_key = STATEMENTS[job]
    fields = STATEMENT_FIELDS[stmt]
    text_cols = ["reported_date", "report_time"] if stmt == "earnings" else ["reported_currency"]
    ts = now()
    rows = {}  # keyed by period + date: AV occasionally repeats a fiscal date
    for period, key in (("annual", annual_key), ("quarterly", quarterly_key)):
        for rep in data.get(key, []):
            fde = day(rep.get("fiscalDateEnding"))
            if not fde:
                continue
            # every row carries every column, so one bulk upsert has uniform keys
            row = {"symbol": symbol, "period": period, "fiscal_date_ending": fde,
                   "extra": None, "fetched_at": ts}
            row.update({c: None for c in text_cols})
            row.update({c: None for c in fields.values()})
            extra = {}
            for k, v in rep.items():
                if k == "fiscalDateEnding":
                    continue
                if k in TEXT_KEYS:
                    if TEXT_KEYS[k] in row:
                        row[TEXT_KEYS[k]] = day(v)
                elif k in fields:
                    row[fields[k]] = num(v)
                elif day(v) is not None:
                    extra[k] = v  # a field AV added since the tables were generated
            if extra:
                row["extra"] = extra
            rows[(period, fde)] = row
    return list(rows.values())


def ingest_statement(symbol, job):
    function, _, table, _, _ = STATEMENTS[job]
    rows = statement_rows(symbol, job, av(function, symbol))
    upsert(table, rows, "symbol,period,fiscal_date_ending")
    touch(symbol, job, max((r["fiscal_date_ending"] for r in rows), default=None))


# ---------------------------------------------------------------------------
# Prices, overview, quote
# ---------------------------------------------------------------------------
def price_rows(symbol, data):
    ts = now()
    rows = {}  # keyed by month: AV dates the current month with today, then re-dates it at month end
    for dt, v in data.get("Monthly Adjusted Time Series", {}).items():
        m = month_of(dt)
        rows[m] = {
            "symbol": symbol, "month": m, "month_end": dt,
            "open": num(v.get("1. open")), "high": num(v.get("2. high")),
            "low": num(v.get("3. low")), "close": num(v.get("4. close")),
            "adjusted_close": num(v.get("5. adjusted close")), "volume": num(v.get("6. volume")),
            "dividend_amount": num(v.get("7. dividend amount")), "fetched_at": ts,
        }
    return list(rows.values())


def ingest_prices(symbol):
    rows = price_rows(symbol, av("TIME_SERIES_MONTHLY_ADJUSTED", symbol))
    upsert("price_monthly", rows, "symbol,month")
    touch(symbol, "prices", max((r["month_end"] for r in rows), default=None))


def has_statements(symbol):
    """One INCOME_STATEMENT call, a single attempt: does Alpha Vantage have financial statements?
    Any failure counts as no; the monthly overview recheck looks again."""
    try:
        d = av("INCOME_STATEMENT", symbol)
    except AVLimitError:
        raise
    except Exception:
        return False
    return bool(d.get("annualReports") or d.get("quarterlyReports"))


def ingest_overview(symbol):
    d = av("OVERVIEW", symbol)
    if not d.get("Symbol"):
        # ETFs, OTC ADRs and unknown symbols come back empty, but so did BLD, PCH and FONR, which
        # had full data in the old files. Statements decide. Either way look again in 30 days.
        touch(symbol, "overview")
        if has_statements(symbol):
            sb.table("ticker").update({"av_status": "ok", "av_checked_at": now()}).eq("symbol", symbol).execute()
            return
        sb.table("ticker").update({"av_status": "no_data", "av_checked_at": now()}).eq("symbol", symbol).execute()
        raise NoFundamentals("no company data (ETF, OTC ADR or unknown symbol); prices and quotes continue")
    sb.table("company_overview").upsert({
        "symbol": symbol, "name": d.get("Name"), "asset_type": d.get("AssetType"),
        "exchange": d.get("Exchange"), "currency": d.get("Currency"), "country": d.get("Country"),
        "sector": d.get("Sector"), "industry": d.get("Industry"),
        "fiscal_year_end": d.get("FiscalYearEnd"), "latest_quarter": day(d.get("LatestQuarter")),
        "market_cap": num(d.get("MarketCapitalization")),
        "shares_outstanding": num(d.get("SharesOutstanding")),
        "description": d.get("Description"),
        "data": {k: v for k, v in d.items() if k != "Description"},
        "fetched_at": now(),
    }).execute()
    sb.table("ticker").update({"av_status": "ok", "av_checked_at": now()}).eq("symbol", symbol).execute()
    touch(symbol, "overview", day(d.get("LatestQuarter")))


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
    touch(symbol, "quote", day(q.get("07. latest trading day")))


JOBS = {
    "overview": ingest_overview,
    "income":   lambda s: ingest_statement(s, "income"),
    "balance":  lambda s: ingest_statement(s, "balance"),
    "cashflow": lambda s: ingest_statement(s, "cashflow"),
    "earnings": lambda s: ingest_statement(s, "earnings"),
    "prices":   ingest_prices,
    "quote":    ingest_quote,
}


# ---------------------------------------------------------------------------
# Whole-market jobs: one call each, not per ticker
# ---------------------------------------------------------------------------
def calendar_rows(csv_text, known):
    ts = now()
    rows = {}
    for r in csv.DictReader(io.StringIO(csv_text)):
        sym, fde, rd = norm(r.get("symbol") or ""), day(r.get("fiscalDateEnding")), day(r.get("reportDate"))
        if sym in known and fde and rd:
            rows[(sym, fde)] = {"symbol": sym, "fiscal_date_ending": fde, "report_date": rd,
                                "estimate": num(r.get("estimate")), "currency": day(r.get("currency")),
                                "fetched_at": ts}
    return list(rows.values())


def ingest_calendar():
    """Who reports in the next 3 months, so statements are fetched only after a report."""
    text = _get("EARNINGS_CALENDAR", {"horizon": "3month"})
    if not isinstance(text, str):
        raise ValueError(f"unexpected EARNINGS_CALENDAR response: {str(text)[:100]}")
    known = {r["symbol"] for r in fetch_all("ticker", "symbol", ["symbol"])}
    rows = calendar_rows(text, known)
    upsert("earnings_calendar", rows, "symbol,fiscal_date_ending")
    print(f"ok   calendar  {len(rows)} upcoming reports for your tickers")


def ingest_fx():
    """Monthly close to USD (USD per 1 unit) for every active non-USD row in `currency`."""
    active = fetch_all("currency", "currency", ["currency"], lambda q: q.eq("is_active", True))
    ts = now()
    for ccy in sorted({r["currency"] for r in active} - {"USD"}):
        def load(ccy=ccy):
            d = av("FX_MONTHLY", f"{ccy}/USD", from_symbol=ccy, to_symbol="USD")
            rows = {}
            for dt, v in d.get("Time Series FX (Monthly)", {}).items():
                rate = num(v.get("4. close"))
                if rate:
                    rows[month_of(dt)] = {"currency": ccy, "month": month_of(dt), "rate": rate, "fetched_at": ts}
            upsert("fx_rate_monthly", list(rows.values()), "currency,month")
            return len(rows)

        try:
            print(f"ok   {ccy}/USD  fx  {with_retries(f'{ccy}/USD fx', load)} months")
        except AVLimitError:
            raise
        except Exception as e:
            ERRORS[f"{ccy}:fx"] = str(e)
            print(f"FAIL {ccy}/USD  fx: {e}")


# ---------------------------------------------------------------------------
# What is due
# ---------------------------------------------------------------------------
def due_symbols(job, symbols, today=None):
    """Tickers that actually need `job` right now."""
    today = today or date.today()
    if job == "quote":
        return set(symbols)

    last = {
        r["symbol"]: datetime.fromisoformat(r["last_success_at"])
        for r in fetch_all("ticker_refresh", "symbol,last_success_at", ["symbol"], lambda q: q.eq("dataset", job))
    }
    now_dt = datetime.now(timezone.utc)

    if job in REFRESH_DAYS:
        limit = timedelta(days=REFRESH_DAYS[job])
        return {s for s in symbols if s not in last or now_dt - last[s] > limit}

    # statements: reported since the last fetch, never fetched, or a periodic safety refresh
    since = (today - timedelta(days=STATEMENT_SAFETY_DAYS)).isoformat()
    reports = fetch_all("earnings_calendar", "symbol,report_date", ["symbol", "report_date"],
                        lambda q: q.gte("report_date", since).lte("report_date", today.isoformat()))
    latest_report = {}
    for r in reports:
        d = date.fromisoformat(r["report_date"])
        if d > latest_report.get(r["symbol"], date.min):
            latest_report[r["symbol"]] = d

    due = set()
    for s in symbols:
        if s not in last or now_dt - last[s] > timedelta(days=STATEMENT_SAFETY_DAYS):
            due.add(s)
        elif s in latest_report:
            published = latest_report[s] + timedelta(days=REPORT_LAG_DAYS)
            if published <= today and last[s].date() < published:
                due.add(s)
    return due


# ---------------------------------------------------------------------------
NO_FUNDAMENTALS_JOBS = ("overview", "prices", "quote")  # what still makes sense without company data


def run_symbol(sym, jobs, due, no_data):
    """Run the due jobs for one ticker. One without company data only gets the overview
    recheck, prices and quotes."""
    skip_statements = no_data
    for job in jobs:
        if sym not in due[job]:
            continue
        if skip_statements and job not in NO_FUNDAMENTALS_JOBS:
            continue
        try:
            with_retries(f"{sym} {job}", lambda: JOBS[job](sym))
            print(f"ok   {sym:<8} {job}")
        except NoFundamentals as e:
            skip_statements = True
            print(f"skip {sym:<8} {e}")
        except SkipSymbol as e:
            print(f"skip {sym:<8} {e}")
            break
        except AVLimitError:
            raise
        except Exception as e:
            ERRORS[f"{sym}:{job}"] = str(e)
            print(f"FAIL {sym:<8} {job}: {e}")
            if job == "overview":
                break  # not worth more calls on a ticker Alpha Vantage cannot even describe right now


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols", nargs="*", help="only these tickers (default: all active); they still fetch only what is due, unless --force")
    ap.add_argument("--only", help="comma list of jobs: calendar,fx," + ",".join(JOBS))
    ap.add_argument("--force", action="store_true", help="ignore what is already up to date")
    args = ap.parse_args()

    jobs = args.only.split(",") if args.only else ["calendar", "fx"] + list(JOBS)
    unknown = [j for j in jobs if j not in ("calendar", "fx") and j not in JOBS]
    if unknown:
        ap.error(f"unknown job(s): {', '.join(unknown)}")
    run_calendar, run_fx = "calendar" in jobs, "fx" in jobs
    # overview first, so a symbol with no data is skipped before spending more calls on it
    jobs = sorted((j for j in jobs if j in JOBS), key=list(JOBS).index)

    if args.symbols:
        symbols = [norm(s) for s in args.symbols]
        sb.table("ticker").upsert([{"symbol": s} for s in symbols],
                                  on_conflict="symbol", ignore_duplicates=True).execute()
    else:
        rows = fetch_all("ticker", "symbol", ["symbol"], lambda q: q.eq("is_active", True))
        symbols = [r["symbol"] for r in rows]
    no_data = {r["symbol"] for r in fetch_all("ticker", "symbol", ["symbol"],
                                              lambda q: q.eq("av_status", "no_data"))}
    force = args.force  # named tickers only narrow the scope; new ones are never fetched, so they get everything anyway

    run_name = (["calendar"] if run_calendar else []) + (["fx"] if run_fx else []) + jobs
    run = sb.table("ingest_run").insert({"jobs": run_name, "symbols": len(symbols)}).execute().data[0]
    status = "success"
    started = datetime.now(timezone.utc)
    try:
        if run_calendar:
            try:
                with_retries("calendar", ingest_calendar)
            except AVLimitError:
                raise
            except Exception as e:  # without it, statements fall back to the periodic safety refresh
                ERRORS["calendar"] = str(e)
                print(f"FAIL calendar: {e}")
        if run_fx:
            ingest_fx()

        due = {}
        for j in jobs:
            pool = symbols if j in NO_FUNDAMENTALS_JOBS else [s for s in symbols if s not in no_data]
            due[j] = set(pool) if force else due_symbols(j, pool)
        print("due:", ", ".join(f"{j} {len(due[j])}" for j in jobs) or "nothing")

        for sym in (symbols if jobs else []):
            run_symbol(sym, jobs, due, sym in no_data)
    except AVLimitError as e:
        status = "rate_limited"
        ERRORS["_limit"] = str(e)
        log_event("STOPPED", "run", e)
        print(f"Stopped by Alpha Vantage limit: {e}")
    except Exception as e:
        status = "failed"
        ERRORS["_fatal"] = str(e)
        log_event("FATAL", "run", e)
        raise
    finally:
        if ERRORS and status == "success":
            status = "partial"
        sb.table("ingest_run").update({
            "finished_at": now(), "status": status, "api_calls": api_calls, "errors": ERRORS or None,
        }).eq("id", run["id"]).execute()
        write_summary(status, started, len(symbols), run_name)
        print(f"Run {run['id']}: {status}, {api_calls} API calls, {len(ERRORS)} errors")

    sys.exit(0 if status == "success" else 1)


if __name__ == "__main__":
    main()
