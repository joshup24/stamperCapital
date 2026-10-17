// Turns a stock's raw statement rows into yearly figures in USD, the ratio stack, the
// value-per-share history and the supporting checks. Pure functions, no network.
//
// Rules: money is converted at the rate of its own period (fx null = missing, never guessed);
// share counts are never converted; missing stays missing (null), never 0, except where the
// database views also default (goodwill, PP&E in the asset value, and dividends).

import { valuate, type Num } from './valuation'

/** One row of income_statement / balance_sheet / cash_flow as loaded: raw column values. */
export interface StatementRow {
  /** fiscal_date_ending, YYYY-MM-DD */
  date: string
  /** year_month, YYYY-MM-DD: statements of one period join on this */
  yearMonth: string
  /** USD per unit of the reported currency; null if no rate exists */
  fx: Num
  /** raw numeric columns by database name */
  v: Record<string, Num>
}

export interface AssetCredits {
  /** share of intangibles counted as value (0 = none) */
  intangibles: number
  /** share of PP&E counted as value (0.5 = half) */
  ppe: number
}

/** Last-resort values, used only if the database cannot be read. The real defaults live in valuation_param
 *  (shared) and user_setting (per user); nothing else should hard-code them. */
export const DEFAULT_CREDITS: AssetCredits = { intangibles: 0, ppe: 0.5 }

export interface YearRow {
  date: string
  yearMonth: string
  // income statement
  revenue: Num
  cogs: Num
  operatingExpenses: Num
  operatingIncome: Num
  ebitda: Num
  netIncome: Num
  netIncomeCont: Num
  /** the lower of net income and continuing-operations income (net income alone when that is missing): the figure the valuation and the ratio stack both use */
  netIncomeUsed: Num
  // balance sheet
  totalAssets: Num
  totalLiabilities: Num
  equity: Num
  cash: Num
  longTermDebt: Num
  intangibles: Num
  ppe: Num
  shares: Num
  // cash flow
  operatingCashflow: Num
  capex: Num
  freeCashflow: Num
  dividends: Num
  financingCashflow: Num
  // derived
  assetsValue: Num
  assetsPerShare: Num
  netIncomePerShare: Num
  netIncomeContPerShare: Num
  ebitdaPerShare: Num
  dividendsPerShare: Num
  /** true when a needed exchange rate was missing, so money figures are blank */
  fxMissing: boolean
}

const get = (r: StatementRow | undefined, col: string): Num => r?.v[col] ?? null
const usd = (r: StatementRow | undefined, col: string): Num => {
  const x = get(r, col)
  return x === null || !r || r.fx === null ? null : x * r.fx
}
const first = (...xs: Num[]): Num => xs.find((x) => x !== null) ?? null
const div = (a: Num, b: Num): Num => (a === null || b === null || b === 0 ? null : a / b)

/** Value of assets, same formula as the database function assets_value(). */
export function assetsValue(
  totalAssets: Num, intangibles: Num, ppe: Num, totalLiabilities: Num, c: AssetCredits = DEFAULT_CREDITS,
): Num {
  if (totalAssets === null || totalLiabilities === null) return null
  return totalAssets - (1 - c.intangibles) * (intangibles ?? 0) - (1 - c.ppe) * (ppe ?? 0) - totalLiabilities
}

/** One YearRow per balance-sheet year, newest last, joining the other statements on year_month. */
export function buildYears(
  income: StatementRow[], balance: StatementRow[], cash: StatementRow[], credits: AssetCredits = DEFAULT_CREDITS,
): YearRow[] {
  const byMonth = (rows: StatementRow[]) => new Map(rows.map((r) => [r.yearMonth, r]))
  const inc = byMonth(income)
  const cf = byMonth(cash)

  return [...balance]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => {
      const i = inc.get(b.yearMonth)
      const c = cf.get(b.yearMonth)

      // Alpha Vantage sometimes folds goodwill into intangibles and sometimes not: take the
      // ex-goodwill figure when given and add goodwill, so it is never counted twice.
      const intangibleBase = first(get(b, 'intangible_assets_excluding_goodwill'), get(b, 'intangible_assets'))
      const intangiblesRaw = (intangibleBase ?? 0) + (get(b, 'goodwill') ?? 0)
      const intangibles = b.fx === null ? null : intangiblesRaw * b.fx

      const totalAssets = usd(b, 'total_assets')
      const totalLiabilities = usd(b, 'total_liabilities')
      const ppe = usd(b, 'property_plant_equipment')
      const shares = get(b, 'common_stock_shares_outstanding')

      const netIncome = usd(i, 'net_income')
      const netIncomeCont = usd(i, 'net_income_from_continuing_operations')
      const netIncomeUsed = netIncome === null ? null : netIncomeCont === null ? netIncome : Math.min(netIncome, netIncomeCont)
      const ebitda = usd(i, 'ebitda')
      const dividends = usd(c, 'dividend_payout')
      const operatingCashflow = usd(c, 'operating_cashflow')
      const capex = usd(c, 'capital_expenditures')

      const av = assetsValue(totalAssets, intangibles, ppe, totalLiabilities, credits)

      return {
        date: b.date,
        yearMonth: b.yearMonth,
        revenue: usd(i, 'total_revenue'),
        cogs: first(usd(i, 'costof_goods_and_services_sold'), usd(i, 'cost_of_revenue')),
        operatingExpenses: usd(i, 'operating_expenses'),
        operatingIncome: usd(i, 'operating_income'),
        ebitda,
        netIncome,
        netIncomeCont,
        netIncomeUsed,
        totalAssets,
        totalLiabilities,
        equity: usd(b, 'total_shareholder_equity'),
        cash: first(usd(b, 'cash_and_cash_equivalents_at_carrying_value'), usd(b, 'cash_and_short_term_investments')),
        longTermDebt: first(usd(b, 'long_term_debt'), usd(b, 'long_term_debt_noncurrent')),
        intangibles,
        ppe,
        shares,
        operatingCashflow,
        capex,
        freeCashflow: operatingCashflow === null ? null : operatingCashflow - (capex ?? 0),
        dividends,
        financingCashflow: usd(c, 'cashflow_from_financing'),
        assetsValue: av,
        assetsPerShare: div(av, shares),
        netIncomePerShare: div(netIncome, shares),
        netIncomeContPerShare: div(netIncomeCont, shares),
        ebitdaPerShare: div(ebitda, shares),
        dividendsPerShare: div(dividends ?? 0, shares),
        fxMissing: b.fx === null,
      }
    })
}

// ---------------------------------------------------------------------------
// Value per share through time, for "share price vs your intrinsic value".
// ---------------------------------------------------------------------------

export interface ValuePoint {
  date: string
  intrinsic: Num
  incomeValue: Num
  ebitdaValue: Num
  assetsValue: Num
}

export function valueHistory(years: YearRow[], multiple: number): ValuePoint[] {
  return years.map((y) => {
    const v = valuate({
      multiple,
      assetsPerShare: y.assetsPerShare,
      netIncomePerShare: y.netIncomePerShare,
      netIncomeContPerShare: y.netIncomeContPerShare,
      ebitdaPerShare: y.ebitdaPerShare,
      dividendsPerShare: y.dividendsPerShare,
      price: null,
    })
    return {
      date: y.date,
      intrinsic: v.intrinsic,
      incomeValue: v.incomeValue,
      ebitdaValue: v.ebitdaValue,
      assetsValue: v.assetsValue,
    }
  })
}

// ---------------------------------------------------------------------------
// Ratio stack: where each dollar of revenue went. Same split as the Power BI report:
//   other = revenue - cost of goods - operating expenses - net income
// The four parts add to 100% by construction, but they only make sense as a stack when
// every part is positive. A loss, or negative "other" (extraordinary gains), flags the year
// so the chart can show it plainly instead of a misleading bar.
// ---------------------------------------------------------------------------

export interface RatioStack {
  date: string
  cogs: number
  operating: number
  other: number
  netIncome: number
  /** true when any part is negative: the 100% bar is not meaningful for this year */
  extraordinary: boolean
}

export function ratioStack(y: YearRow): RatioStack | null {
  const { revenue, cogs, operatingExpenses } = y
  const netIncome = y.netIncomeUsed // lower of net income and continuing operations, as in the valuation
  if (revenue === null || revenue <= 0 || cogs === null || operatingExpenses === null || netIncome === null) return null
  const other = revenue - cogs - operatingExpenses - netIncome
  const parts = { cogs: cogs / revenue, operating: operatingExpenses / revenue, other: other / revenue, netIncome: netIncome / revenue }
  return {
    date: y.date,
    ...parts,
    extraordinary: Object.values(parts).some((p) => p < 0),
  }
}

// ---------------------------------------------------------------------------
// Supporting checks: quick yes/no signals that sit beside possible gain. PROVISIONAL: the
// list is meant to be replaced with Joshua's own definitions. Each check returns pass, fail,
// or unknown (not enough data); unknown never counts as a pass.
// ---------------------------------------------------------------------------

export type CheckStatus = 'pass' | 'fail' | 'unknown'

export interface CheckResult {
  key: string
  label: string
  status: CheckStatus
  detail: string
}

const lastN = <T,>(xs: T[], n: number) => xs.slice(-n)
const nums = (xs: Num[]) => xs.filter((x): x is number => x !== null)

/** Dividend per share flat or rising over the last `years` years (2% slack for rounding). */
export function dividendsFlatOrRising(years: YearRow[], window = 5): CheckResult {
  const base = { key: 'dividends', label: 'Dividends flat or rising' }
  const vals = nums(lastN(years, window).map((y) => y.dividendsPerShare))
  if (vals.length < 3) return { ...base, status: 'unknown', detail: 'Not enough years of data' }
  if (vals.every((v) => v === 0)) return { ...base, status: 'unknown', detail: 'Pays no dividend' }
  const dips = vals.some((v, i) => i > 0 && v < vals[i - 1] * 0.98)
  return { ...base, status: dips ? 'fail' : 'pass', detail: dips ? 'Dividend per share fell in a year' : `Held or grew over ${vals.length} years` }
}

/** Share count flat or falling over the last `years` years (2% slack). */
export function sharesFlatOrFalling(years: YearRow[], window = 5): CheckResult {
  const base = { key: 'shares', label: 'Shares flat or falling' }
  const vals = nums(lastN(years, window).map((y) => y.shares))
  if (vals.length < 3) return { ...base, status: 'unknown', detail: 'Not enough years of data' }
  const grew = vals[vals.length - 1] > vals[0] * 1.02
  return { ...base, status: grew ? 'fail' : 'pass', detail: grew ? 'Share count grew' : 'Share count held or shrank' }
}

/** Positive GAAP net income in each of the last `window` years. */
export function profitable(years: YearRow[], window = 3): CheckResult {
  const base = { key: 'profit', label: 'Profitable every year' }
  const vals = nums(lastN(years, window).map((y) => y.netIncome))
  if (vals.length < window) return { ...base, status: 'unknown', detail: 'Not enough years of data' }
  const ok = vals.every((v) => v > 0)
  return { ...base, status: ok ? 'pass' : 'fail', detail: ok ? `Positive in the last ${window} years` : 'A loss in the last 3 years' }
}

/** Positive operating cash flow in each of the last `window` years. */
export function cashGenerative(years: YearRow[], window = 3): CheckResult {
  const base = { key: 'cash', label: 'Operating cash flow positive' }
  const vals = nums(lastN(years, window).map((y) => y.operatingCashflow))
  if (vals.length < window) return { ...base, status: 'unknown', detail: 'Not enough years of data' }
  const ok = vals.every((v) => v > 0)
  return { ...base, status: ok ? 'pass' : 'fail', detail: ok ? `Positive in the last ${window} years` : 'Negative in a recent year' }
}

export function supportingChecks(years: YearRow[]): CheckResult[] {
  return [dividendsFlatOrRising(years), sharesFlatOrFalling(years), profitable(years), cashGenerative(years)]
}

export function checkScore(results: CheckResult[]): { passed: number; known: number; total: number } {
  return {
    passed: results.filter((r) => r.status === 'pass').length,
    known: results.filter((r) => r.status !== 'unknown').length,
    total: results.length,
  }
}

/** Change from the previous year, as a fraction. Null if either is missing or the base is not positive. */
export function yearChange(now: Num, before: Num): Num {
  if (now === null || before === null || before <= 0) return null
  return now / before - 1
}
