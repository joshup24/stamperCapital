import { describe, expect, it } from 'vitest'
import { isDrawableCandle, yearlyPrices, type PriceBar } from './prices'

const bar = (month: string, p: Partial<PriceBar> = {}): PriceBar => ({
  month, open: 10, high: 12, low: 9, close: 11, adjustedClose: 11, dividend: null, ...p,
})

describe('yearlyPrices', () => {
  const bars = [
    bar('2023-01-01', { high: 20, low: 8, close: 15, dividend: 1 }),
    bar('2023-03-01', { high: 25, low: 12, close: 22, dividend: 1 }),
    bar('2023-02-01', { high: 18, low: 6, close: 14, dividend: null }),
    bar('2024-01-01', { high: 30, low: 20, close: 28, dividend: 1.1 }),
  ]
  const out = yearlyPrices(bars)

  it('groups by calendar year, oldest first', () => {
    expect(out.map((y) => y.year)).toEqual([2023, 2024])
  })

  it('takes the highest high and lowest low', () => {
    expect(out[0].high).toBe(25)
    expect(out[0].low).toBe(6)
  })

  it('closes on the last month even if bars arrive out of order', () => {
    expect(out[0].close).toBe(22)
  })

  it('sums dividends and keeps "none paid" as missing, not zero', () => {
    expect(out[0].dividends).toBe(2)
    expect(yearlyPrices([bar('2020-01-01')])[0].dividends).toBeNull()
  })

  it('ignores missing values rather than treating them as zero', () => {
    const y = yearlyPrices([bar('2021-01-01', { low: null, high: null, close: null })])[0]
    expect(y.low).toBeNull()
    expect(y.high).toBeNull()
    expect(y.close).toBeNull()
  })

  it('handles no data', () => {
    expect(yearlyPrices([])).toEqual([])
  })
})

describe('isDrawableCandle', () => {
  it('accepts a normal bar and rejects missing or inconsistent ones', () => {
    expect(isDrawableCandle(bar('2023-01-01'))).toBe(true)
    expect(isDrawableCandle(bar('2023-01-01', { open: null }))).toBe(false)
    expect(isDrawableCandle(bar('2023-01-01', { high: 5 }))).toBe(false)
    expect(isDrawableCandle(bar('2023-01-01', { low: 20 }))).toBe(false)
  })
})
