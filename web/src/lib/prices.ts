// Monthly price bars and what we derive from them. Pure functions, no network.
import type { Num } from './valuation'

export interface PriceBar {
  /** first day of the month, YYYY-MM-DD */
  month: string
  open: Num
  high: Num
  low: Num
  close: Num
  adjustedClose: Num
  /** dividend paid per share in this month */
  dividend: Num
}

export interface PriceYear {
  year: number
  high: Num
  low: Num
  /** close of the last month we have for that year */
  close: Num
  /** sum of the monthly dividends per share */
  dividends: Num
  months: number
}

const maxOf = (xs: number[]): Num => (xs.length ? Math.max(...xs) : null)
const minOf = (xs: number[]): Num => (xs.length ? Math.min(...xs) : null)
const present = (xs: Num[]): number[] => xs.filter((x): x is number => x !== null)

/** Calendar-year summary of monthly bars: high, low, closing price and dividends paid. */
export function yearlyPrices(bars: PriceBar[]): PriceYear[] {
  const byYear = new Map<number, PriceBar[]>()
  for (const b of bars) {
    const y = Number(b.month.slice(0, 4))
    if (!Number.isFinite(y)) continue
    ;(byYear.get(y) ?? byYear.set(y, []).get(y)!).push(b)
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => {
      const sorted = [...list].sort((a, b) => a.month.localeCompare(b.month))
      const closes = sorted.filter((b) => b.close !== null)
      const divs = present(sorted.map((b) => b.dividend))
      return {
        year,
        high: maxOf(present(sorted.map((b) => b.high))),
        low: minOf(present(sorted.map((b) => b.low))),
        close: closes.length ? closes[closes.length - 1].close : null,
        dividends: divs.length ? divs.reduce((a, b) => a + b, 0) : null,
        months: sorted.length,
      }
    })
}

/** A candle needs all four of open, high, low, close, and a sane high/low. */
export function isDrawableCandle(b: PriceBar): boolean {
  const { open, high, low, close } = b
  if (open === null || high === null || low === null || close === null) return false
  return high >= low && high >= Math.max(open, close) && low <= Math.min(open, close)
}
