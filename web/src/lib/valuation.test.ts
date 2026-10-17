import { describe, expect, it } from 'vitest'
import { gainOverPrice, isAlert, resolveMultiple, valuate } from './valuation'

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

describe('income value uses the lower of net income and continuing operations', () => {
  it('takes continuing operations when it is lower', () => {
    expect(valuate({ ...MO, netIncomeContPerShare: 3 }).incomeValue).toBeCloseTo(33, 6)
  })
  it('takes net income when it is lower', () => {
    expect(valuate({ ...MO, netIncomeContPerShare: 9 }).incomeValue).toBeCloseTo(50.71, 2)
  })
  it('uses net income when continuing operations is missing', () => {
    expect(valuate({ ...MO, netIncomeContPerShare: null }).incomeValue).toBeCloseTo(50.71, 2)
    expect(valuate(MO).incomeValue).toBeCloseTo(50.71, 2)
  })
  it('stays missing when net income itself is missing', () => {
    expect(valuate({ ...MO, netIncomePerShare: null, netIncomeContPerShare: 3 }).incomeValue).toBeNull()
  })
})

describe('alerts, VoI - Price and the break-even multiple', () => {
  it('computes them for MO as the Equity Summary does', () => {
    const r = valuate(MO)
    expect(r.voiMinusPrice).toBeCloseTo(50.71 - 49.33, 2)
    expect(r.alert1).toBeCloseTo(-14.06 - 49.33, 2)
    expect(r.alert2).toBeCloseTo(-14.06 + 42.24 - 49.33, 2)
    expect(r.breakEvenMultiple).toBeCloseTo((49.33 + 14.06 - 42.24) / 4.61, 3) // about 4.6
  })
  it('the break-even multiple is blank when net income is not positive', () => {
    expect(valuate({ ...MO, netIncomePerShare: 0 }).breakEvenMultiple).toBeNull()
    expect(valuate({ ...MO, netIncomePerShare: -1 }).breakEvenMultiple).toBeNull()
    expect(valuate({ ...MO, netIncomePerShare: null }).breakEvenMultiple).toBeNull()
  })
  it('the break-even multiple goes negative when assets plus dividends already exceed the price', () => {
    const r = valuate({ ...MO, assetsPerShare: 40, price: 50, dividendsPerShare: 2 }) // 40 + 22 = 62 > 50
    expect(r.breakEvenMultiple!).toBeLessThan(0)
    expect(r.alert2!).toBeGreaterThan(0)
  })
  it('alerts and VoI - Price are blank without a price or the needed value', () => {
    const noPrice = valuate({ ...MO, price: null })
    expect([noPrice.alert1, noPrice.alert2, noPrice.voiMinusPrice, noPrice.breakEvenMultiple]).toEqual([null, null, null, null])
    const noAssets = valuate({ ...MO, assetsPerShare: null })
    expect([noAssets.alert1, noAssets.alert2, noAssets.breakEvenMultiple]).toEqual([null, null, null])
    expect(valuate({ ...MO, netIncomePerShare: null }).voiMinusPrice).toBeNull()
  })
})

describe('isAlert', () => {
  it('is on only above zero; zero, negative and missing are not alerts', () => {
    expect(isAlert(0.01)).toBe(true)
    expect(isAlert(42)).toBe(true)
    expect(isAlert(0)).toBe(false)
    expect(isAlert(-5)).toBe(false)
    expect(isAlert(null)).toBe(false)
  })
})
