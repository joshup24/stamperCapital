// Shapes financial years into the points each chart draws. Pure functions, so they are tested.
// Missing values stay null, which the charts draw as a gap, never as zero.
import type { Point } from '../../components/charts/TimeChart'
import { ratioStack, valueHistory, type YearRow } from '../../lib/financials'
import type { PriceYear } from '../../lib/prices'

export type Period = 'annual' | 'quarterly'

/** "2023" for annual rows, "2023-09" for quarterly. */
export function label(date: string, period: Period): string {
  return period === 'annual' ? date.slice(0, 4) : date.slice(0, 7)
}

export function balancePoints(years: YearRow[], period: Period): Point[] {
  return years.map((y) => ({
    label: label(y.date, period),
    assets: y.totalAssets, liabilities: y.totalLiabilities, value: y.assetsValue,
  }))
}

export function cashPoints(years: YearRow[], period: Period): Point[] {
  return years.map((y) => ({
    label: label(y.date, period),
    operating: y.operatingCashflow, free: y.freeCashflow, dividends: y.dividends, capex: y.capex,
  }))
}

export function earningsPoints(years: YearRow[], period: Period): Point[] {
  return years.map((y) => ({
    label: label(y.date, period),
    revenue: y.revenue, netIncome: y.netIncome, ebitda: y.ebitda,
  }))
}

export function epsPoints(years: YearRow[], period: Period): Point[] {
  return years.map((y) => ({
    label: label(y.date, period),
    eps: y.netIncomePerShare, ebitdaPerShare: y.ebitdaPerShare,
  }))
}

export function sharesPoints(years: YearRow[], period: Period): Point[] {
  return years.map((y) => ({ label: label(y.date, period), shares: y.shares }))
}

/** Dividends per share by year: what the share price data recorded, beside the cash flow statement. */
export function dividendPoints(years: YearRow[], prices: PriceYear[]): Point[] {
  const paid = new Map(prices.map((p) => [String(p.year), p.dividends]))
  const stated = new Map(years.map((y) => [y.date.slice(0, 4), y.dividendsPerShare]))
  const labels = [...new Set([...paid.keys(), ...stated.keys()])].sort()
  return labels.map((l) => ({ label: l, paid: paid.get(l) ?? null, statement: stated.get(l) ?? null }))
}

/** Price range and closing price beside your value per share, by year. */
export function valuePoints(years: YearRow[], prices: PriceYear[], multiple: number): Point[] {
  const values = valueHistory(years, multiple)
  const val = new Map(values.map((v) => [v.date.slice(0, 4), v]))
  const px = new Map(prices.map((p) => [String(p.year), p]))
  const labels = [...new Set([...val.keys(), ...px.keys()])].sort()
  return labels.map((l) => ({
    label: l,
    high: px.get(l)?.high ?? null,
    low: px.get(l)?.low ?? null,
    close: px.get(l)?.close ?? null,
    intrinsic: val.get(l)?.intrinsic ?? null,
    income: val.get(l)?.incomeValue ?? null,
    ebitda: val.get(l)?.ebitdaValue ?? null,
  }))
}

export interface RatioData {
  /** points for the 100% stack; extraordinary or incomplete periods are left empty */
  points: Point[]
  /** every period's ratios, for the table under the chart, in the order shown */
  table: { label: string; cogs: number; operating: number; other: number; netIncome: number; extraordinary: boolean }[]
  /** labels of periods left out of the stack because a part was negative */
  excluded: string[]
}

export function ratioData(years: YearRow[], period: Period): RatioData {
  const points: Point[] = []
  const table: RatioData['table'] = []
  const excluded: string[] = []
  for (const y of years) {
    const l = label(y.date, period)
    const r = ratioStack(y)
    if (r && !r.extraordinary) {
      points.push({ label: l, cogs: r.cogs, operating: r.operating, other: r.other, netIncome: r.netIncome })
    } else {
      points.push({ label: l, cogs: null, operating: null, other: null, netIncome: null })
    }
    if (r) {
      table.push({ label: l, cogs: r.cogs, operating: r.operating, other: r.other, netIncome: r.netIncome, extraordinary: r.extraordinary })
      if (r.extraordinary) excluded.push(l)
    }
  }
  return { points, table, excluded }
}
