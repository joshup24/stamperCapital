"""Tests for ingest/rules.py. Run from the repo root:  python -m unittest discover -s ingest -v"""
import unittest
from datetime import date

from rules import (PARK_AFTER, PARK_DAYS, drop_parked, failure_state, is_parked, job_name_mistakes,
                   needs_single_try, parse_date)

JOBS = ["calendar", "fx", "overview", "income", "balance", "cashflow", "earnings", "prices", "quote"]
TODAY = date(2026, 10, 16)


class JobNameGuard(unittest.TestCase):
    def test_flags_job_names_whatever_the_case_or_spacing(self):
        self.assertEqual(job_name_mistakes(["fx"], JOBS), ["fx"])
        self.assertEqual(job_name_mistakes(["FX", " Quote ", "PRICES"], JOBS), ["FX", " Quote ", "PRICES"])

    def test_real_tickers_pass(self):
        self.assertEqual(job_name_mistakes(["AAPL", "BRK-B", "MO", "FXI"], JOBS), [])

    def test_only_the_bad_ones_are_returned(self):
        self.assertEqual(job_name_mistakes(["MO", "fx", "PM"], JOBS), ["fx"])

    def test_nothing_typed_is_fine(self):
        self.assertEqual(job_name_mistakes([], JOBS), [])


class ParseDate(unittest.TestCase):
    def test_accepts_strings_dates_and_blanks(self):
        self.assertEqual(parse_date("2026-11-15"), date(2026, 11, 15))
        self.assertEqual(parse_date("2026-11-15T00:00:00+00:00"), date(2026, 11, 15))
        self.assertEqual(parse_date(date(2026, 1, 2)), date(2026, 1, 2))
        self.assertIsNone(parse_date(None))
        self.assertIsNone(parse_date(""))


class Parking(unittest.TestCase):
    def test_the_agreed_values(self):
        self.assertEqual((PARK_AFTER, PARK_DAYS), (3, 7))  # three failing runs in a row, then 7 days aside

    def test_first_and_second_failures_are_counted_but_not_parked(self):
        self.assertEqual(failure_state(0, TODAY), (1, None))
        self.assertEqual(failure_state(1, TODAY), (2, None))

    def test_parks_on_the_third_failure_for_the_park_period(self):
        count, until = failure_state(PARK_AFTER - 1, TODAY)
        self.assertEqual(count, PARK_AFTER)
        self.assertEqual((until - TODAY).days, PARK_DAYS)

    def test_a_failed_recheck_parks_again(self):
        count, until = failure_state(5, TODAY)
        self.assertEqual(count, 6)
        self.assertIsNotNone(until)

    def test_parked_only_until_the_recheck_date(self):
        until = date(2026, 11, 15)
        self.assertTrue(is_parked(until, date(2026, 11, 14)))
        self.assertFalse(is_parked(until, date(2026, 11, 15)))
        self.assertFalse(is_parked(until, date(2026, 12, 1)))
        self.assertFalse(is_parked(None, TODAY))

    def test_known_bad_stocks_get_a_single_try(self):
        self.assertFalse(needs_single_try(0))
        self.assertFalse(needs_single_try(PARK_AFTER - 1))
        self.assertTrue(needs_single_try(PARK_AFTER))

    def test_drop_parked_removes_only_parked_symbols(self):
        state = {"BAD": (2, date(2026, 11, 15)), "OLD": (2, date(2026, 10, 1)), "NEW": (1, None)}
        remaining, parked = drop_parked({"BAD", "OLD", "NEW", "FINE"}, state, TODAY)
        self.assertEqual(parked, ["BAD"])
        self.assertEqual(remaining, {"OLD", "NEW", "FINE"})  # OLD's park has expired: recheck it

    def test_drop_parked_with_no_state_changes_nothing(self):
        remaining, parked = drop_parked({"A", "B"}, {}, TODAY)
        self.assertEqual((remaining, parked), ({"A", "B"}, []))


if __name__ == "__main__":
    unittest.main()
