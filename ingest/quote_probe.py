"""Temporary experiment: record what GLOBAL_QUOTE returns right now, to find out when
Alpha Vantage catches up with the close. See supabase/migrations/*_quote_probe.sql.

  python ingest/quote_probe.py [SYMBOL ...]

The first symbol is also probed with the 'delayed' and 'realtime' entitlements, which
shows which of those your plan includes (the response says if it does not).
"""
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
SYMBOLS = sys.argv[1:] or ["MO", "XOM", "UNP", "PEP", "QQQ"]


def num(v):
    if v is None:
        return None
    s = str(v).strip().rstrip("%").replace(",", "")
    try:
        return str(Decimal(s)) if s not in ("", "None", "-") else None
    except InvalidOperation:
        return None


def probe_row(symbol, variant, data, probed_at):
    q = data.get("Global Quote") or {}
    return {
        "probed_at": probed_at, "symbol": symbol, "variant": variant,
        "latest_trading_day": q.get("07. latest trading day") or None,
        "price": num(q.get("05. price")), "volume": num(q.get("06. volume")),
        "previous_close": num(q.get("08. previous close")),
        "raw": data,
    }


def fetch(symbol, entitlement=None):
    params = {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": os.environ["ALPHAVANTAGE_API_KEY"]}
    if entitlement:
        params["entitlement"] = entitlement
    r = requests.get(AV_URL, params=params, timeout=60)
    r.raise_for_status()
    return r.json() if r.text.lstrip().startswith("{") else {"raw_text": r.text[:300]}


def main():
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])
    calls = [(s, "default", None) for s in SYMBOLS] + [(SYMBOLS[0], "delayed", "delayed"), (SYMBOLS[0], "realtime", "realtime")]
    rows = []
    for symbol, variant, entitlement in calls:
        probed_at = datetime.now(timezone.utc).isoformat()
        row = probe_row(symbol, variant, fetch(symbol, entitlement), probed_at)
        rows.append(row)
        why = "" if row["price"] else f"  <- no quote; Alpha Vantage said: {str(row['raw'])[:300]}"
        print(f"{probed_at[11:19]}Z {symbol:<5} {variant:<9} day={row['latest_trading_day']} price={row['price']} volume={row['volume']}{why}")
        time.sleep(1)  # well inside the plan's per-minute limit
    sb.table("quote_probe").insert(rows).execute()
    print(f"recorded {len(rows)} rows")


if __name__ == "__main__":
    main()
