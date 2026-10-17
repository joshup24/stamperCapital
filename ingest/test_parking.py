"""Tests of the loader's handling of stray tickers, run against stand-ins for Supabase and Alpha Vantage
(nothing here touches the network or a real database).
Run from the repo root:  python -m unittest discover -s ingest -v"""
import importlib
import os
import sys
import tempfile
import types
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from rules import PARK_AFTER, PARK_DAYS

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tools"))

os.environ.setdefault("ALPHAVANTAGE_API_KEY", "test")
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test")


class FakeQuery:
    def __init__(self, db, table, op, data):
        self.db, self.table, self.op, self.data, self.filters = db, table, op, data, []

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def execute(self):
        self.db.calls.append((self.table, self.op, self.data, tuple(self.filters)))
        return types.SimpleNamespace(data=[])


class FakeTable:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def update(self, data):
        return FakeQuery(self.db, self.name, "update", data)

    def upsert(self, data, **_):
        return FakeQuery(self.db, self.name, "upsert", data)

    def insert(self, data):
        return FakeQuery(self.db, self.name, "insert", data)


class FakeDB:
    def __init__(self):
        self.calls = []

    def table(self, name):
        return FakeTable(self, name)


# av_ingest builds a Supabase client and reads a .env at import time: give it stand-ins for the packages
# that may not be installed where the tests run.
for name, attrs in {
    "supabase": {"create_client": lambda *a, **k: FakeDB()},
    "dotenv": {"load_dotenv": lambda *a, **k: None},
}.items():
    stub = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(stub, k, v)
    sys.modules.setdefault(name, stub)
try:
    import requests  # noqa: F401
except ImportError:
    sys.modules["requests"] = types.ModuleType("requests")

av_ingest = importlib.import_module("av_ingest")
send_report = importlib.import_module("send_report")

REJECTED = ValueError("Invalid API call. Please retry or visit the documentation for TIME_SERIES_MONTHLY_ADJUSTED.")


class LoaderTestCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.sleeps, self.attempts = [], []
        self.patches = [
            mock.patch.object(av_ingest, "sb", self.db),
            mock.patch.object(av_ingest.time, "sleep", lambda s: self.sleeps.append(s)),
            mock.patch.object(av_ingest, "log_event", lambda *a, **k: None),
        ]
        for p in self.patches:
            p.start()
        for d in (av_ingest.ERRORS, av_ingest.WARNINGS, av_ingest.PRICE_STATE, av_ingest.DONE, av_ingest.RUN_NOTES):
            d.clear()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def prices_job(self, outcome):
        """Make the prices job raise `outcome` (an exception) or succeed (None), counting the attempts."""
        def job(symbol):
            self.attempts.append(symbol)
            if outcome is not None:
                raise outcome
        return mock.patch.dict(av_ingest.JOBS, {"prices": job})

    def run_prices(self, symbol, no_data):
        av_ingest.run_symbol(symbol, ["prices"], {"prices": {symbol}}, no_data)

    def saved(self):
        return [c for c in self.db.calls if c[0] == "ticker" and c[1] == "update"]


class StrayTickerPrices(LoaderTestCase):
    def test_first_failure_is_a_warning_not_an_error_and_is_still_retried(self):
        with self.prices_job(REJECTED):
            self.run_prices("BAD", no_data=True)
        self.assertEqual(av_ingest.ERRORS, {})                       # the run stays green
        self.assertIn("BAD:prices", av_ingest.WARNINGS)
        self.assertEqual(self.sleeps, [10, 30, 60])                  # a passing hiccup gets its retries
        self.assertEqual(len(self.attempts), 4)
        self.assertEqual(av_ingest.PRICE_STATE["BAD"], (1, None))    # counted, not parked yet
        self.assertEqual(self.saved()[-1][2], {"price_fail_count": 1, "price_parked_until": None})

    def test_second_failure_is_still_just_counted_and_retried(self):
        av_ingest.PRICE_STATE["BAD"] = (1, None)
        with self.prices_job(REJECTED):
            self.run_prices("BAD", no_data=True)
        self.assertEqual(av_ingest.PRICE_STATE["BAD"], (2, None))
        self.assertEqual(self.sleeps, [10, 30, 60])
        self.assertNotIn("set aside", av_ingest.WARNINGS["BAD:prices"])
        self.assertEqual(av_ingest.ERRORS, {})

    def test_the_third_failure_in_a_row_sets_the_prices_aside_for_the_park_period(self):
        av_ingest.PRICE_STATE["BAD"] = (PARK_AFTER - 1, None)
        with self.prices_job(REJECTED):
            self.run_prices("BAD", no_data=True)
        count, until = av_ingest.PRICE_STATE["BAD"]
        self.assertEqual(count, PARK_AFTER)
        self.assertEqual(until, date.today() + timedelta(days=PARK_DAYS))
        self.assertEqual((PARK_AFTER, PARK_DAYS), (3, 7))
        self.assertIn("set aside until", av_ingest.WARNINGS["BAD:prices"])
        self.assertEqual(av_ingest.ERRORS, {})

    def test_a_known_bad_stock_coming_up_for_recheck_gets_one_try_and_no_waiting(self):
        av_ingest.PRICE_STATE["BAD"] = (PARK_AFTER, date.today() - timedelta(days=1))   # park has expired
        with self.prices_job(REJECTED):
            self.run_prices("BAD", no_data=True)
        self.assertEqual(self.sleeps, [])                            # no 100 seconds of retries
        self.assertEqual(len(self.attempts), 1)
        self.assertEqual(av_ingest.PRICE_STATE["BAD"][0], PARK_AFTER + 1)
        self.assertEqual(av_ingest.PRICE_STATE["BAD"][1], date.today() + timedelta(days=PARK_DAYS))  # parked again
        self.assertEqual(av_ingest.ERRORS, {})

    def test_when_it_works_again_the_failures_are_forgotten(self):
        av_ingest.PRICE_STATE["BAD"] = (PARK_AFTER, date.today() - timedelta(days=1))
        with self.prices_job(None):
            self.run_prices("BAD", no_data=True)
        self.assertNotIn("BAD", av_ingest.PRICE_STATE)
        self.assertEqual(self.saved()[-1][2], {"price_fail_count": 0, "price_parked_until": None})
        self.assertIn("BAD", av_ingest.DONE["prices"])
        self.assertEqual(av_ingest.WARNINGS, {})

    def test_a_transient_failure_that_recovers_leaves_no_trace(self):
        with self.prices_job(None):
            self.run_prices("ETF", no_data=True)
        self.assertEqual(self.saved(), [])                           # nothing to record for a healthy stock
        self.assertEqual((av_ingest.ERRORS, av_ingest.WARNINGS), ({}, {}))


class RealCompaniesKeepTheirErrors(LoaderTestCase):
    def test_a_stock_with_company_data_whose_prices_fail_is_still_an_error(self):
        with self.prices_job(REJECTED):
            self.run_prices("AAPL", no_data=False)
        self.assertIn("AAPL:prices", av_ingest.ERRORS)               # a real problem still turns the run red
        self.assertEqual(av_ingest.WARNINGS, {})
        self.assertEqual(self.sleeps, [10, 30, 60])
        self.assertEqual(self.saved(), [])                           # and nothing is parked

    def test_a_failure_in_another_job_for_a_no_data_stock_is_still_an_error(self):
        def quote(_):
            raise ValueError("boom")
        with mock.patch.dict(av_ingest.JOBS, {"quote": quote}):
            av_ingest.run_symbol("ETF", ["quote"], {"quote": {"ETF"}}, True)
        self.assertIn("ETF:quote", av_ingest.ERRORS)


class BookkeepingNeverFailsTheRun(LoaderTestCase):
    def test_missing_columns_turn_parking_off_instead_of_crashing(self):
        def broken_fetch(*a, **k):
            raise RuntimeError("column ticker.price_fail_count does not exist")
        with mock.patch.object(av_ingest, "fetch_all", broken_fetch):
            self.assertEqual(av_ingest.load_price_state(), {})

    def test_state_is_read_back_as_numbers_and_dates(self):
        rows = [{"symbol": "BAD", "price_fail_count": 3, "price_parked_until": "2026-11-15"}]
        with mock.patch.object(av_ingest, "fetch_all", lambda *a, **k: rows):
            self.assertEqual(av_ingest.load_price_state(), {"BAD": (3, date(2026, 11, 15))})

    def test_a_failed_save_is_swallowed(self):
        class Broken:
            def table(self, _):
                raise RuntimeError("database down")
        with mock.patch.object(av_ingest, "sb", Broken()):
            av_ingest.save_price_state("BAD", 1, None)               # must not raise
        self.assertEqual(av_ingest.PRICE_STATE["BAD"], (1, None))


class JobNameGuard(LoaderTestCase):
    def test_a_job_name_in_the_tickers_box_is_refused_and_nothing_is_written(self):
        with mock.patch.object(sys, "argv", ["av_ingest.py", "fx"]), self.assertRaises(SystemExit) as cm, \
                mock.patch("sys.stderr", new=tempfile.TemporaryFile("w+")):
            av_ingest.main()
        self.assertEqual(cm.exception.code, 2)
        self.assertEqual(self.db.calls, [])                          # no ticker was created

    def test_the_message_says_where_the_job_name_belongs(self):
        err = tempfile.TemporaryFile("w+")
        with mock.patch.object(sys, "argv", ["av_ingest.py", "MO", "quote"]), self.assertRaises(SystemExit), \
                mock.patch("sys.stderr", new=err):
            av_ingest.main()
        err.seek(0)
        text = err.read()
        self.assertIn("quote", text)
        self.assertIn("job name", text)
        self.assertIn("jobs", text)


class ReportShowsWarnings(LoaderTestCase):
    def test_the_summary_lists_warnings_and_parked_stocks_without_calling_the_run_failed(self):
        av_ingest.WARNINGS["BAD:prices"] = "Invalid API call (set aside until 2026-11-15)"
        av_ingest.RUN_NOTES["parked_prices"] = 2
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(av_ingest, "LOG_PATH", Path(tmp) / "ingest_errors.log"):
            av_ingest.write_summary("success", av_ingest.datetime.now(av_ingest.timezone.utc), 10, ["quote"])
            text = (Path(tmp) / "ingest_summary.txt").read_text(encoding="utf-8")
        self.assertIn("status: success", text)
        self.assertIn("errors: 0", text)
        self.assertIn("warnings: 1", text)
        self.assertIn("parked_prices: 2", text)
        self.assertIn("warning: BAD:prices: Invalid API call", text)

        parsed = send_report.parse_summary(text)
        self.assertEqual(parsed["error_list"], [])
        self.assertEqual(len(parsed["warning_list"]), 1)
        message = send_report.build_message(text, "", "a@b.c", "d@e.f")
        body = message.get_content()
        self.assertIn("WARNINGS", body)
        self.assertIn("BAD:prices", body)
        self.assertIn("2 stock(s)", body)
        self.assertIn("SUCCESS", message["Subject"])


if __name__ == "__main__":
    unittest.main()
