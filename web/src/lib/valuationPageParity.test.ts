import { describe, expect, it } from 'vitest'
import { buildYears, ratioStack, valueHistory, type StatementRow } from './financials'

// ESLT from the Power BI "Valuation" page (Type = Annual). Raw figures are in thousands of USD, as the report
// shows them (the "K" suffix); the expected values are what the report computed. Missing PP&E in 2023 is blank.
const K = 1000
const YEARS = ['2019', '2020', '2021', '2022', '2023']

const bs: Record<string, (number | null)[]> = {
  total_assets: [7335358, 8057897, 9317344, 9215651, 9658976],
  intangible_assets: [310796, 290846, 473865, 435061, 390520],
  property_plant_equipment: [1132295, 1210060, 1319067, 1354653, null],
  total_liabilities: [5175518, 5826530, 6771081, 6457976, 6733102],
  common_stock_shares_outstanding: [43848, 44215, 44278, 44581, 44592],
}
const inc: Record<string, (number | null)[]> = {
  total_revenue: [4508400, 4662572, 5278521, 5511549, 6068641],
  costof_goods_and_services_sold: [3371933, 3497465, 3920473, 4138266, 4562382],
  operating_expenses: [814857, 839420, 939540, 1005799, 1130919],
  ebitda: [452513, 477515, 576935, 505212, 542729],
  net_income: [227857, 237658, 274350, 275448, 215131],
  net_income_from_continuing_operations: [228655, 237986, 274663, 275469, 270925],
}
const cf: Record<string, (number | null)[]> = {
  dividend_payout: [62578, 78194, 79175, 86813, 89248],
  operating_cashflow: [-53318, 278834, 416932, 240068, 115496],
  capital_expenditures: [137604, 132210, 188624, 205110, 189976],
}

const rows = (t: Record<string, (number | null)[]>, i: number): StatementRow => ({
  date: `${YEARS[i]}-12-31`,
  yearMonth: `${YEARS[i]}-12-01`,
  fx: 1,
  v: Object.fromEntries(
    // the report shows everything in thousands (shares too: "43,848K"), so multiply them all back up
    Object.entries(t).map(([k, vals]) => [k, vals[i] === null ? null : vals[i]! * K]),
  ),
})
const idx = [0, 1, 2, 3, 4]
const years = buildYears(idx.map((i) => rows(inc, i)), idx.map((i) => rows(bs, i)), idx.map((i) => rows(cf, i)))
const values = valueHistory(years, 11)

const expected = {
  valueOfAssets: [1282897, 1335491, 1412865, 1645288, 2535354],
  valueOfAssetsPerShare: [29.26, 30.2, 31.91, 36.91, 56.86],
  otherExpenses: [93753, 88029, 144158, 92036, 160209],
  ebitdaRev: [0.1, 0.102, 0.109, 0.092, 0.089],
  netIncomeRev: [0.051, 0.051, 0.052, 0.05, 0.035],
  cogsRev: [0.748, 0.75, 0.743, 0.751, 0.752],
  operatingRev: [0.181, 0.18, 0.178, 0.182, 0.186],
  otherRev: [0.021, 0.019, 0.027, 0.017, 0.026],
  netIncomePerShare: [5.2, 5.38, 6.2, 6.18, 4.82],
  netIncomeValuePerShare: [57.16, 59.13, 68.16, 67.96, 53.02],
  ebitdaPerShare: [10.32, 10.8, 13.03, 11.33, 12.16],
  dividendsPerShare: [1.43, 1.77, 1.79, 1.95, 2.0],
  dividendValuePerShare: [15.7, 19.45, 19.67, 21.42, 22.0],
}

describe('parity with the Power BI Valuation page (ESLT, annual, 2019-2023)', () => {
  it('value of assets and per share (missing PP&E counts as nothing to discount)', () => {
    idx.forEach((i) => {
      expect(years[i].assetsValue! / K, YEARS[i]).toBeCloseTo(expected.valueOfAssets[i], -1) // within thousands rounding
      expect(years[i].assetsPerShare!, YEARS[i]).toBeCloseTo(expected.valueOfAssetsPerShare[i], 1)
    })
  })

  it('other expenses = revenue - cost of goods - operating expenses - net income', () => {
    idx.forEach((i) => {
      const r = years[i]
      expect((r.revenue! - r.cogs! - r.operatingExpenses! - r.netIncome!) / K, YEARS[i]).toBeCloseTo(expected.otherExpenses[i], 0)
    })
  })

  it('the revenue ratios match the report to a tenth of a percent', () => {
    idx.forEach((i) => {
      const r = ratioStack(years[i])!
      expect(r.cogs, YEARS[i]).toBeCloseTo(expected.cogsRev[i], 3)
      expect(r.operating, YEARS[i]).toBeCloseTo(expected.operatingRev[i], 3)
      expect(r.other, YEARS[i]).toBeCloseTo(expected.otherRev[i], 3)
      expect(r.netIncome, YEARS[i]).toBeCloseTo(expected.netIncomeRev[i], 3)
      expect(years[i].ebitda! / years[i].revenue!, YEARS[i]).toBeCloseTo(expected.ebitdaRev[i], 3)
      expect(r.extraordinary).toBe(false)
    })
  })

  it('per-share figures and values at a multiple of 11', () => {
    idx.forEach((i) => {
      // the report divides by its own _cShares, which differs from balance-sheet shares by under 0.1%
      expect(years[i].netIncomePerShare!, YEARS[i]).toBeCloseTo(expected.netIncomePerShare[i], 1)
      expect(values[i].incomeValue!, YEARS[i]).toBeGreaterThan(expected.netIncomeValuePerShare[i] - 0.15)
      expect(values[i].incomeValue!, YEARS[i]).toBeLessThan(expected.netIncomeValuePerShare[i] + 0.15)
      expect(years[i].ebitdaPerShare!, YEARS[i]).toBeCloseTo(expected.ebitdaPerShare[i], 1)
      expect(years[i].dividendsPerShare!, YEARS[i]).toBeCloseTo(expected.dividendsPerShare[i], 1)
      expect(11 * years[i].dividendsPerShare!, YEARS[i]).toBeGreaterThan(expected.dividendValuePerShare[i] - 0.1)
      expect(11 * years[i].dividendsPerShare!, YEARS[i]).toBeLessThan(expected.dividendValuePerShare[i] + 0.1)
    })
  })

  it('the lower-of rule agrees with the report: net income is the lower figure in every one of these years', () => {
    idx.forEach((i) => expect(years[i].netIncome!).toBeLessThanOrEqual(years[i].netIncomeCont!))
  })

  it('the cash flow lines pass straight through', () => {
    expect(years[4].operatingCashflow! / K).toBe(115496)
    expect(years[4].capex! / K).toBe(189976)
  })
})
