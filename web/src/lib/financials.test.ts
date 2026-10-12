import { describe, expect, it } from 'vitest'
import {
  assetsValue, buildYears, cashGenerative, checkScore, dividendsFlatOrRising, profitable,
  ratioStack, sharesFlatOrFalling, valueHistory, yearChange, type StatementRow, type YearRow,
} from './financials'

// Altria (MO) from the Power BI report. The report prints thousands (23,494,000K), so raw dollars below.
const row = (date: string, v: Record<string, number | null>, fx: number | null = 1): StatementRow => ({
  date, yearMonth: date.slice(0, 7) + '-01', fx, v,
})

// NOTE: the report prints 23,494,000K = 23.494 billion; in raw dollars that is 23,494,000,000.
const inc = row('2023-12-31', {
  total_revenue: 23_494_000_000, costof_goods_and_services_sold: 6_218_000_000,
  operating_expenses: 348_000_000, ebitda: 12_205_000_000, net_income: 8_130_000_000,
})
const bal = row('2023-12-31', {
  total_assets: 38_570_000_000, intangible_assets: 20_477_000_000, property_plant_equipment: 1_652_000_000,
  total_liabilities: 42_060_000_000, common_stock_shares_outstanding: 1_763_462_000,
})
const cf = row('2023-12-31', {
  operating_cashflow: 9_287_000_000, dividend_payout: 6_779_000_000, capital_expenditures: 196_000_000,
})

describe('assetsValue', () => {
  it('matches the report for MO 2023 (-24.793bn)', () => {
    expect(assetsValue(38_570_000_000, 20_477_000_000, 1_652_000_000, 42_060_000_000)).toBe(-24_793_000_000)
  })
  it('is null if assets or liabilities are missing', () => {
    expect(assetsValue(null, 1, 1, 1)).toBeNull()
    expect(assetsValue(1, 1, 1, null)).toBeNull()
  })
})

describe('buildYears', () => {
  const [y] = buildYears([inc], [bal], [cf])

  it('joins the three statements on year-month', () => {
    expect(y.revenue).toBe(23_494_000_000)
    expect(y.netIncome).toBe(8_130_000_000)
    expect(y.dividends).toBe(6_779_000_000)
  })

  it('matches the report per-share figures', () => {
    expect(y.netIncomePerShare).toBeCloseTo(4.61, 2)
    expect(y.dividendsPerShare).toBeCloseTo(3.84, 2)
    expect(y.ebitdaPerShare).toBeCloseTo(6.92, 2)
    expect(y.assetsPerShare).toBeCloseTo(-14.06, 2)
  })

  it('free cash flow is operating cash flow minus capex', () => {
    expect(y.freeCashflow).toBe(9_287_000_000 - 196_000_000)
  })

  it('converts money at the period rate but never share counts', () => {
    const [c] = buildYears([inc], [{ ...bal, fx: 0.5 }], [cf])
    expect(c.totalAssets).toBe(19_285_000_000)
    expect(c.shares).toBe(1_763_462_000)
  })

  it('a missing rate blanks the money instead of guessing', () => {
    const [m] = buildYears([inc], [{ ...bal, fx: null }], [cf])
    expect(m.totalAssets).toBeNull()
    expect(m.assetsValue).toBeNull()
    expect(m.fxMissing).toBe(true)
  })

  it('a year with no income statement keeps income figures missing', () => {
    const [m] = buildYears([], [bal], [cf])
    expect(m.netIncome).toBeNull()
    expect(m.netIncomePerShare).toBeNull()
  })

  it('adds goodwill once when intangibles exclude it, and not twice when they include it', () => {
    const withExcl = row('2023-12-31', { ...bal.v, intangible_assets_excluding_goodwill: 5, intangible_assets: 99, goodwill: 3 })
    expect(buildYears([], [withExcl], [])[0].intangibles).toBe(8)
    const inclusive = row('2023-12-31', { ...bal.v, intangible_assets: 10, goodwill: null })
    expect(buildYears([], [inclusive], [])[0].intangibles).toBe(10)
  })

  it('sorts oldest to newest', () => {
    const older = row('2022-12-31', bal.v)
    const out = buildYears([], [bal, older], [])
    expect(out.map((o) => o.date)).toEqual(['2022-12-31', '2023-12-31'])
  })
})

describe('valueHistory', () => {
  it('values each year with the given multiple', () => {
    const [p] = valueHistory(buildYears([inc], [bal], [cf]), 11)
    expect(p.intrinsic).toBeCloseTo(78.89, 1)
    expect(p.assetsValue).toBeCloseTo(-14.06, 2)
  })
})

describe('ratioStack', () => {
  const y = buildYears([inc], [bal], [cf])[0]

  it('matches the report: cogs 26.5, operating 1.5, other 37.4, net income 34.6', () => {
    const r = ratioStack(y)!
    expect(r.cogs * 100).toBeCloseTo(26.5, 1)
    expect(r.operating * 100).toBeCloseTo(1.5, 1)
    expect(r.other * 100).toBeCloseTo(37.4, 1)
    expect(r.netIncome * 100).toBeCloseTo(34.6, 1)
    expect(r.extraordinary).toBe(false)
  })

  it('adds to 100%', () => {
    const r = ratioStack(y)!
    expect(r.cogs + r.operating + r.other + r.netIncome).toBeCloseTo(1, 10)
  })

  it('flags a loss as extraordinary (2019: net income -1,293)', () => {
    const loss = { ...y, netIncome: -1_293_000_000, revenue: 23_830_000_000, cogs: 7_085_000_000, operatingExpenses: 535_000_000 }
    const r = ratioStack(loss)!
    expect(r.netIncome).toBeLessThan(0)
    expect(r.extraordinary).toBe(true)
  })

  it('is null when a needed figure is missing or revenue is not positive', () => {
    expect(ratioStack({ ...y, cogs: null })).toBeNull()
    expect(ratioStack({ ...y, revenue: 0 })).toBeNull()
    expect(ratioStack({ ...y, revenue: null })).toBeNull()
  })
})

const yr = (n: number, p: Partial<YearRow>): YearRow =>
  ({ ...buildYears([], [row(`${2018 + n}-12-31`, {})], [])[0], ...p })

describe('supporting checks', () => {
  const years = (f: (n: number) => Partial<YearRow>) => [0, 1, 2, 3, 4].map((n) => yr(n, f(n)))

  it('dividends: rising passes, a cut fails, none is unknown', () => {
    expect(dividendsFlatOrRising(years((n) => ({ dividendsPerShare: 1 + n * 0.1 }))).status).toBe('pass')
    expect(dividendsFlatOrRising(years((n) => ({ dividendsPerShare: n === 3 ? 0.5 : 1 }))).status).toBe('fail')
    expect(dividendsFlatOrRising(years(() => ({ dividendsPerShare: 0 }))).status).toBe('unknown')
  })

  it('shares: falling passes, growing fails', () => {
    expect(sharesFlatOrFalling(years((n) => ({ shares: 100 - n }))).status).toBe('pass')
    expect(sharesFlatOrFalling(years((n) => ({ shares: 100 + n * 5 }))).status).toBe('fail')
  })

  it('profit and cash flow need every recent year positive', () => {
    expect(profitable(years(() => ({ netIncome: 5 }))).status).toBe('pass')
    expect(profitable(years((n) => ({ netIncome: n === 4 ? -1 : 5 }))).status).toBe('fail')
    expect(cashGenerative(years(() => ({ operatingCashflow: 5 }))).status).toBe('pass')
    expect(cashGenerative(years((n) => ({ operatingCashflow: n === 3 ? -1 : 5 }))).status).toBe('fail')
  })

  it('too little data is unknown, never a pass', () => {
    expect(profitable([yr(0, { netIncome: 5 })]).status).toBe('unknown')
    expect(sharesFlatOrFalling([]).status).toBe('unknown')
  })

  it('score counts passes among known checks', () => {
    const s = checkScore([
      { key: 'a', label: '', status: 'pass', detail: '' },
      { key: 'b', label: '', status: 'fail', detail: '' },
      { key: 'c', label: '', status: 'unknown', detail: '' },
    ])
    expect(s).toEqual({ passed: 1, known: 2, total: 3 })
  })
})

describe('yearChange', () => {
  it('is the fractional change, null when the base is missing or not positive', () => {
    expect(yearChange(110, 100)).toBeCloseTo(0.1, 10)
    expect(yearChange(5, null)).toBeNull()
    expect(yearChange(5, -3)).toBeNull()
    expect(yearChange(5, 0)).toBeNull()
  })
})
