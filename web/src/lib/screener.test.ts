import { describe, expect, it } from 'vitest'
import {
  NO_FILTERS, applyFilters, buildRow, passes, sortByNumber,
  type Component, type UserSettings,
} from './screener'

const base: Component = {
  symbol: 'MO', name: 'Altria Group', sector: 'Consumer Staples', industry: 'Tobacco', category: null,
  price: 49.33, priceDate: '2026-10-09', assetsPerShare: -14.06,
  assetParts: null, shares: 1_763_462_000, currency: 'USD',
  fy: { netIncome: 4.61, netIncomeCont: null, ebitda: 6.92, dividends: 3.84, revenue: 23_494_000_000 },
  ttm: { netIncome: null, netIncomeCont: null, ebitda: null, dividends: null, revenue: null },
  balanceSheetDate: '2026-06-30', anyOverridden: false, fxMissing: false,
}

const empty: UserSettings = {
  defaultMultiple: 11,
  credits: { intangibles: 0, ppe: 0.5 },
  sharedCredits: { intangibles: 0, ppe: 0.5 },
  userCredits: { intangibles: null, ppe: null },
  user: { ticker: {}, category: {}, industry: {}, sector: {} },
  shared: { category: {}, industry: {}, sector: {} },
  userCategory: {},
  groups: {},
}

describe('buildRow', () => {
  it('uses the default multiple when nothing is set', () => {
    const r = buildRow(base, empty, 'fy')
    expect(r.multiple).toBe(11)
    expect(r.multipleSource).toBe('default')
    expect(r.valuation.intrinsic).toBeCloseTo(78.89, 2)
  })

  it('a user ticker multiple beats everything', () => {
    const s = { ...empty, user: { ...empty.user, ticker: { MO: 7 }, industry: { TOBACCO: 9 } } }
    const r = buildRow(base, s, 'fy')
    expect(r.multiple).toBe(7)
    expect(r.multipleSource).toBe('ticker')
  })

  it('uses the user category, which comes from the user mapping before the shared one', () => {
    const s: UserSettings = {
      ...empty,
      userCategory: { MO: 'SIN' },
      user: { ...empty.user, category: { SIN: 14, TOBACCOCAT: 5 } },
    }
    const r = buildRow({ ...base, category: 'TOBACCOCAT' }, s, 'fy')
    expect(r.category).toBe('SIN')
    expect(r.multiple).toBe(14)
    expect(r.multipleSource).toBe('category')
  })

  it('falls back to a shared industry rule when the user has none', () => {
    const s = { ...empty, shared: { ...empty.shared, industry: { TOBACCO: 8 } } }
    const r = buildRow(base, s, 'fy')
    expect(r.multiple).toBe(8)
    expect(r.multipleSource).toBe('industry')
  })

  it('the user rule beats the shared rule at the same level', () => {
    const s = {
      ...empty,
      user: { ...empty.user, industry: { TOBACCO: 12 } },
      shared: { ...empty.shared, industry: { TOBACCO: 8 } },
    }
    expect(buildRow(base, s, 'fy').multiple).toBe(12)
  })

  it('trailing basis stays missing when four quarters are not available', () => {
    const r = buildRow(base, empty, 'ttm')
    expect(r.valuation.intrinsic).toBeNull()
    expect(r.valuation.possibleGain).toBeNull()
  })
})

describe('passes and filters', () => {
  const mo = buildRow(base, empty, 'fy')
  const cheap = buildRow(
    { ...base, symbol: 'ZZZ', name: 'Zed', sector: 'Energy', industry: 'Oil', price: 200, assetsPerShare: 5 },
    empty, 'fy',
  )
  const gap = buildRow({ ...base, symbol: 'GAP', fy: { ...base.fy, netIncome: null, ebitda: null, dividends: 0 } }, empty, 'fy')
  const rows = [mo, cheap, gap]

  it('total value test', () => {
    expect(passes(mo, 'total')).toBe(true)
    expect(passes(cheap, 'total')).toBe(false)
  })

  it('assets test fails when assets per share are negative', () => {
    expect(passes(mo, 'assets')).toBe(false)
  })

  it('missing data never passes a test', () => {
    expect(passes(gap, 'income')).toBe(false)
    expect(passes(gap, 'total')).toBe(false)
  })

  it('filters by group, sector and search', () => {
    const groups = { MYERS: ['MO'] }
    expect(applyFilters(rows, { ...NO_FILTERS, group: 'MYERS' }, groups).map((r) => r.symbol)).toEqual(['MO'])
    expect(applyFilters(rows, { ...NO_FILTERS, sector: 'Energy' }, groups).map((r) => r.symbol)).toEqual(['ZZZ'])
    expect(applyFilters(rows, { ...NO_FILTERS, search: 'zed' }, groups).map((r) => r.symbol)).toEqual(['ZZZ'])
  })

  it('filters by category, using the user category over the shared one', () => {
    const s = { ...empty, userCategory: { MO: 'SIN' } }
    const tagged = buildRow({ ...base, category: 'OLD' }, s, 'fy')
    const other = buildRow({ ...base, symbol: 'OTH', category: 'DEFENSE' }, s, 'fy')
    expect(tagged.category).toBe('SIN')
    const out = applyFilters([tagged, other], { ...NO_FILTERS, category: 'SIN' }, {})
    expect(out.map((r) => r.symbol)).toEqual(['MO'])
  })

  it('search matches partial text in the symbol or name, ignoring punctuation', () => {
    expect(applyFilters(rows, { ...NO_FILTERS, search: 'zz' }, {}).map((r) => r.symbol)).toEqual(['ZZZ'])
    expect(applyFilters(rows, { ...NO_FILTERS, search: 'altr' }, {}).map((r) => r.symbol)).toEqual(['MO', 'GAP'])
  })

  it('a chosen symbol narrows to exactly that stock, not other partial matches', () => {
    expect(applyFilters(rows, { ...NO_FILTERS, symbol: 'MO' }, {}).map((r) => r.symbol)).toEqual(['MO'])
  })

  it('minimum gain excludes rows with no gain figure', () => {
    const out = applyFilters(rows, { ...NO_FILTERS, minGain: 0.2 }, {})
    expect(out.map((r) => r.symbol)).toEqual(['MO'])
  })

  it('all selected tests must pass', () => {
    const out = applyFilters(rows, { ...NO_FILTERS, tests: ['total', 'assets'] }, {})
    expect(out).toEqual([])
  })
})

describe('sortByNumber', () => {
  it('puts missing values last in both directions', () => {
    const items = [{ v: 2 }, { v: null }, { v: 5 }, { v: 1 }]
    expect(sortByNumber(items, (i) => i.v, true).map((i) => i.v)).toEqual([5, 2, 1, null])
    expect(sortByNumber(items, (i) => i.v, false).map((i) => i.v)).toEqual([1, 2, 5, null])
  })
})

import { sortBy } from './screener'

describe('sortBy', () => {
  it('sorts text, ignoring case, with missing last', () => {
    const items = [{ v: 'beta' }, { v: null }, { v: 'Alpha' }, { v: 'gamma' }]
    expect(sortBy(items, (i) => i.v as string, false).map((i) => i.v)).toEqual(['Alpha', 'beta', 'gamma', null])
    expect(sortBy(items, (i) => i.v as string, true).map((i) => i.v)).toEqual(['gamma', 'beta', 'Alpha', null])
  })

  it('sorts numbers numerically, not as text', () => {
    const items = [{ v: 10 }, { v: 9 }, { v: 100 }]
    expect(sortBy(items, (i) => i.v, false).map((i) => i.v)).toEqual([9, 10, 100])
  })
})

describe('balance sheet credits are the user\'s own setting', () => {
  // per share, USD: assets 38.57, liabilities 42.06, intangibles 20.48, PP&E 1.65 (MO, 2023-ish)
  const parts = { totalAssets: 38.57, totalLiabilities: 42.06, intangibles: 20.48, ppe: 1.65 }
  const withParts = { ...base, assetParts: parts, assetsPerShare: 999 }

  it('0% of intangibles and 50% of PP&E gives the report\'s value of assets', () => {
    const r = buildRow(withParts, empty, 'fy')
    expect(r.valuation.assetsValue).toBeCloseTo(38.57 - 42.06 - 20.48 - 0.5 * 1.65, 6)
  })

  it('a different credit changes the answer, so nothing is hard-coded', () => {
    const generous = { ...empty, credits: { intangibles: 0.25, ppe: 1 } }
    const r = buildRow(withParts, generous, 'fy')
    expect(r.valuation.assetsValue).toBeCloseTo(38.57 - 42.06 - 0.75 * 20.48, 6)
    expect(r.valuation.assetsValue!).toBeGreaterThan(buildRow(withParts, empty, 'fy').valuation.assetsValue!)
  })

  it('falls back to the precomputed assets per share when the view has no parts', () => {
    expect(buildRow({ ...base, assetParts: null, assetsPerShare: -14.06 }, empty, 'fy').valuation.assetsValue).toBe(-14.06)
  })

  it('missing liabilities keep the value missing instead of becoming zero', () => {
    const r = buildRow({ ...base, assetParts: { ...parts, totalLiabilities: null } }, empty, 'fy')
    expect(r.valuation.assetsValue).toBeNull()
  })
})

describe('Equity Summary columns on a row', () => {
  it('market cap is shares x price in thousands, revenue in thousands, currency passes through', () => {
    const r = buildRow({ ...base, shares: 1_000_000_000, price: 50, currency: 'CAD' }, empty, 'fy')
    expect(r.marketCap000s).toBe(50_000_000)
    expect(r.revenue000s).toBe(23_494_000)
    expect(r.currency).toBe('CAD')
  })

  it('market cap and revenue stay missing when their inputs are missing', () => {
    expect(buildRow({ ...base, shares: null }, empty, 'fy').marketCap000s).toBeNull()
    expect(buildRow(base, empty, 'ttm').revenue000s).toBeNull()
  })

  it('income value uses the lower of net income and continuing operations', () => {
    const lower = buildRow({ ...base, fy: { ...base.fy, netIncome: 4.61, netIncomeCont: 3.0 } }, empty, 'fy')
    expect(lower.valuation.incomeValue).toBeCloseTo(11 * 3.0, 6)
  })
})
