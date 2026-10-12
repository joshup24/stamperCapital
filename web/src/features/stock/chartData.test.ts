import { describe, expect, it } from 'vitest'
import { buildYears, type StatementRow } from '../../lib/financials'
import type { PriceYear } from '../../lib/prices'
import { dividendPoints, label, ratioData, valuePoints } from './chartData'

const row = (date: string, v: Record<string, number | null>): StatementRow => ({
  date, yearMonth: date.slice(0, 7) + '-01', fx: 1, v,
})

const years = buildYears(
  [
    row('2022-12-31', { total_revenue: 1000, costof_goods_and_services_sold: 300, operating_expenses: 50, net_income: 250, ebitda: 400 }),
    row('2023-12-31', { total_revenue: 1000, costof_goods_and_services_sold: 300, operating_expenses: 50, net_income: -100, ebitda: 100 }),
  ],
  [
    row('2022-12-31', { total_assets: 2000, total_liabilities: 1500, common_stock_shares_outstanding: 100, property_plant_equipment: 0 }),
    row('2023-12-31', { total_assets: 2000, total_liabilities: 1500, common_stock_shares_outstanding: 100, property_plant_equipment: 0 }),
  ],
  [
    row('2022-12-31', { dividend_payout: 100, operating_cashflow: 300, capital_expenditures: 50 }),
    row('2023-12-31', { dividend_payout: 100, operating_cashflow: 300, capital_expenditures: 50 }),
  ],
)

const prices: PriceYear[] = [
  { year: 2021, high: 30, low: 20, close: 25, dividends: 1, months: 12 },
  { year: 2022, high: 40, low: 22, close: 35, dividends: 1.1, months: 12 },
]

describe('label', () => {
  it('uses the year for annual and year-month for quarterly', () => {
    expect(label('2023-09-30', 'annual')).toBe('2023')
    expect(label('2023-09-30', 'quarterly')).toBe('2023-09')
  })
})

describe('ratioData', () => {
  const r = ratioData(years, 'annual')

  it('stacks a normal year to 100%', () => {
    const p = r.points[0]
    const sum = (p.cogs as number) + (p.operating as number) + (p.other as number) + (p.netIncome as number)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('leaves a loss year out of the stack but keeps it in the table and says so', () => {
    expect(r.points[1].netIncome).toBeNull()
    expect(r.excluded).toEqual(['2023'])
    expect(r.table.find((t) => t.label === '2023')?.netIncome).toBeCloseTo(-0.1, 10)
  })
})

describe('valuePoints', () => {
  const pts = valuePoints(years, prices, 10)

  it('joins price years and value years by year, keeping years that only have one', () => {
    expect(pts.map((p) => p.label)).toEqual(['2021', '2022', '2023'])
    expect(pts[0].intrinsic).toBeNull() // no statements for 2021
    expect(pts[2].high).toBeNull()      // no prices for 2023
  })

  it('values a year with the given multiple', () => {
    // 2022: assets 500/100 = 5; income 10 x 2.5 = 25; dividends 10 x 1 = 10
    expect(pts[1].intrinsic).toBeCloseTo(40, 6)
    expect(pts[1].income).toBeCloseTo(25, 6)
  })
})

describe('dividendPoints', () => {
  it('lines up price-data dividends with statement dividends per share', () => {
    const d = dividendPoints(years, prices)
    expect(d.map((p) => p.label)).toEqual(['2021', '2022', '2023'])
    expect(d[1]).toEqual({ label: '2022', paid: 1.1, statement: 1 })
    expect(d[0].statement).toBeNull()
  })
})
