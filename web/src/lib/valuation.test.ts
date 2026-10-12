import { describe, expect, it } from 'vitest'
import { gainOverPrice, resolveMultiple, valuate } from './valuation'

// Altria (MO), fiscal 2023, from the Power BI report: multiple 11,
// net income/share 4.61, dividends/share 3.84, assets/share -14.06, price 49.33.
// Report shows income value 50.71 and dividend value 42.29 (we get 42.24: the report divides unrounded figures).
const MO = {
  multiple: 11,
  assetsPerShare: -14.06,
  netIncomePerShare: 4.61,
  ebitdaPerShare: 6.92,
  dividendsPerShare: 3.84,
  price: 49.33,
}

describe('valuate', () => {
  it('matches the report components for MO', () => {
    const r = valuate(MO)
    expect(r.incomeValue).toBeCloseTo(50.71, 2)
    expect(r.dividendValue).toBeCloseTo(42.24, 2)
    expect(r.ebitdaValue).toBeCloseTo(76.12, 2)
    expect(r.intrinsic).toBeCloseTo(78.89, 2)
  })

  it('computes possible gain as intrinsic over price minus one', () => {
    const r = valuate(MO)
    expect(r.possibleGain).toBeCloseTo(78.89 / 49.33 - 1, 3)
  })

  it('a different multiple changes the result', () => {
    const low = valuate({ ...MO, multiple: 8 })
    const high = valuate({ ...MO, multiple: 14 })
    expect(high.intrinsic!).toBeGreaterThan(low.intrinsic!)
  })

  it('keeps missing net income missing instead of treating it as zero', () => {
    const r = valuate({ ...MO, netIncomePerShare: null })
    expect(r.incomeValue).toBeNull()
    expect(r.intrinsic).toBeNull()
    expect(r.possibleGain).toBeNull()
    // The EBITDA basis does not depend on net income, so it still computes.
    expect(r.intrinsicOnEbitda).not.toBeNull()
  })

  it('keeps missing assets missing', () => {
    const r = valuate({ ...MO, assetsPerShare: null })
    expect(r.intrinsic).toBeNull()
    expect(r.intrinsicOnEbitda).toBeNull()
  })

  it('treats a missing dividend as no dividend', () => {
    const r = valuate({ ...MO, dividendsPerShare: null })
    expect(r.dividendValue).toBe(0)
    expect(r.intrinsic).toBeCloseTo(50.71 - 14.06, 2)
  })

  it('allows negative net income and negative intrinsic value', () => {
    const r = valuate({ ...MO, netIncomePerShare: -0.7, dividendsPerShare: 0 })
    expect(r.incomeValue).toBeCloseTo(-7.7, 2)
    expect(r.intrinsic!).toBeLessThan(0)
    expect(r.possibleGain!).toBeLessThan(-1)
  })
})

describe('gainOverPrice', () => {
  it('is null without a usable price', () => {
    expect(gainOverPrice(10, null)).toBeNull()
    expect(gainOverPrice(10, 0)).toBeNull()
    expect(gainOverPrice(10, -5)).toBeNull()
    expect(gainOverPrice(null, 10)).toBeNull()
  })

  it('is 0.5 when value is 50% above price', () => {
    expect(gainOverPrice(15, 10)).toBeCloseTo(0.5, 10)
  })
})

describe('resolveMultiple', () => {
  const fallback = 11

  it('prefers ticker over everything', () => {
    expect(resolveMultiple({ ticker: 9, category: 12, industry: 10, sector: 8, fallback })).toEqual({
      multiple: 9,
      source: 'ticker',
    })
  })

  it('then category, industry, sector', () => {
    expect(resolveMultiple({ category: 12, industry: 10, sector: 8, fallback }).source).toBe('category')
    expect(resolveMultiple({ industry: 10, sector: 8, fallback }).source).toBe('industry')
    expect(resolveMultiple({ sector: 8, fallback }).source).toBe('sector')
  })

  it('falls back to the default', () => {
    expect(resolveMultiple({ fallback })).toEqual({ multiple: 11, source: 'default' })
  })

  it('treats a multiple of 0 as a real setting, not as missing', () => {
    expect(resolveMultiple({ ticker: 0, fallback }).multiple).toBe(0)
  })
})
