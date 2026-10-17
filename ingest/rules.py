"""Small decisions the loader makes, kept free of the network and the database so they can be tested.

Two jobs:
  * catching a job name typed where a ticker belongs (it would otherwise be added as a ticker);
  * deciding when a stock with no company data should have its price requests set aside.
"""
from datetime import date, timedelta

# A stock with no company data (an ETF, an OTC ADR, a delisted name) sometimes has no monthly price
# history either; Alpha Vantage then answers "Invalid API call" every time. After this many failing
# runs in a row its prices are set aside for PARK_DAYS, then tried once more.
PARK_AFTER = 3
PARK_DAYS = 7


def job_name_mistakes(symbols, job_names):
    """The entries of `symbols` that are really job names ("fx", "quote"...), case ignored. Typing one
    into the tickers box of the GitHub form would add it to the database as a ticker."""
    names = {n.lower() for n in job_names}
    return [s for s in symbols if s.strip().lower() in names]


def parse_date(value):
    """'2026-10-16' (what the database sends back) or a date or None -> a date or None."""
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def is_parked(parked_until, today):
    """True while a stock's prices are set aside (strictly before the recheck date)."""
    return parked_until is not None and today < parked_until


def failure_state(count, today):
    """One more failing run: (new count, parked_until). parked_until is None until the stock has failed
    PARK_AFTER runs in a row."""
    new_count = count + 1
    return new_count, (today + timedelta(days=PARK_DAYS) if new_count >= PARK_AFTER else None)


def needs_single_try(count):
    """A stock that has already failed PARK_AFTER runs gets one attempt on a recheck, not the full
    wait-and-retry sequence: it is a known problem, not a passing hiccup."""
    return count >= PARK_AFTER


def drop_parked(due_symbols, state, today):
    """(symbols still due, sorted symbols left out because they are set aside).
    `state` maps symbol -> (failure count, parked_until)."""
    parked = sorted(s for s in due_symbols if is_parked(state.get(s, (0, None))[1], today))
    return set(due_symbols) - set(parked), parked
