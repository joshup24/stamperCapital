import { useMemo } from 'react'
import TimeChart, { type Series } from '../../components/charts/TimeChart'
import CandleChart from '../../components/charts/CandleChart'
import type { YearRow } from '../../lib/financials'
import type { PriceBar } from '../../lib/prices'
import { yearlyPrices } from '../../lib/prices'
import { compactMoney, money, percent } from '../../lib/format'
import {
  balancePoints, cashPoints, dividendPoints, earningsPoints, epsPoints, ratioData, sharesPoints, valuePoints,
  type Period,
} from './chartData'

export type ChartKey = 'balance' | 'cash' | 'earnings' | 'eps' | 'dividends' | 'shares' | 'value' | 'candles' | 'ratios'

/** Charts that can switch between annual and quarterly figures. */
export const PERIOD_CHARTS: ChartKey[] = ['balance', 'cash', 'earnings', 'eps', 'shares', 'ratios']

export const CHART_TABS: { key: ChartKey; label: string }[] = [
  { key: 'balance', label: 'Balance sheet' },
  { key: 'cash', label: 'Cash flow' },
  { key: 'earnings', label: 'Revenue & earnings' },
  { key: 'eps', label: 'EPS' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'shares', label: 'Shares' },
  { key: 'value', label: 'Price vs value' },
  { key: 'candles', label: 'Candles' },
  { key: 'ratios', label: 'Ratios' },
]

interface Props {
  chart: ChartKey
  period: Period
  /** years for the selected period */
  years: YearRow[]
  /** annual years, always, for charts that are yearly by nature */
  annual: YearRow[]
  bars: PriceBar[]
  multiple: number
}

const bar = (key: string, label: string, color: number, stackId?: string): Series => ({ key, label, kind: 'bar', color, stackId })
const line = (key: string, label: string, color: number, dashed = false): Series => ({ key, label, kind: 'line', color, dashed })

const pct = (n: number) => percent(n, 0)
const count = (n: number) => compactMoney(n, false)

export default function ChartsTab({ chart, period, years, annual, bars, multiple }: Props) {
  const priceYears = useMemo(() => yearlyPrices(bars), [bars])
  const ratios = useMemo(() => ratioData(years, period), [years, period])

  switch (chart) {
    case 'balance':
      return (
        <ChartCard title="Balance sheet" note="Value of assets = total assets − intangibles and goodwill − half of PP&E − total liabilities. It can be negative.">
          <TimeChart
            data={balancePoints(years, period)} format={compactMoney}
            series={[bar('value', 'Value of assets', 1), line('assets', 'Total assets', 3), line('liabilities', 'Total liabilities', 5)]}
          />
        </ChartCard>
      )
    case 'cash':
      return (
        <ChartCard title="Cash flow" note="Free cash flow = operating cash flow − capital expenditures.">
          <TimeChart
            data={cashPoints(years, period)} format={compactMoney}
            series={[bar('operating', 'Operating cash flow', 1), bar('free', 'Free cash flow', 3), line('dividends', 'Dividends paid', 2), line('capex', 'Capital expenditures', 5, true)]}
          />
        </ChartCard>
      )
    case 'earnings':
      return (
        <ChartCard title="Revenue & earnings">
          <TimeChart
            data={earningsPoints(years, period)} format={compactMoney}
            series={[bar('revenue', 'Revenue', 1), bar('netIncome', 'Net income', 3), line('ebitda', 'EBITDA', 2)]}
          />
        </ChartCard>
      )
    case 'eps':
      return (
        <ChartCard title="Earnings per share" note="GAAP net income per share, not adjusted. EBITDA per share is for reference.">
          <TimeChart
            data={epsPoints(years, period)} format={(n) => money(n)}
            series={[bar('eps', 'Net income / share', 1), line('ebitdaPerShare', 'EBITDA / share', 2, true)]}
          />
        </ChartCard>
      )
    case 'dividends':
      return (
        <ChartCard title="Dividends per share" note="Bars: dividends recorded in the share price history. Line: dividends paid per share from the cash flow statement. Annual.">
          <TimeChart
            data={dividendPoints(annual, priceYears)} format={(n) => money(n)}
            series={[bar('paid', 'Paid (price history)', 1), line('statement', 'Cash flow statement', 2, true)]}
          />
        </ChartCard>
      )
    case 'shares':
      return (
        <ChartCard title="Shares outstanding">
          <TimeChart data={sharesPoints(years, period)} format={count} series={[bar('shares', 'Shares outstanding', 1)]} />
        </ChartCard>
      )
    case 'value':
      return (
        <ChartCard title="Share price vs your intrinsic value" note={`Your multiple: ${multiple}. Value per year uses that year's statements. Price shows each calendar year's high, low and closing price. Annual.`}>
          <TimeChart
            data={valuePoints(annual, priceYears, multiple)} format={(n) => money(n)}
            series={[
              line('high', 'Price high', 6, true), line('low', 'Price low', 6, true), line('close', 'Price close', 1),
              line('intrinsic', 'Intrinsic value', 3), line('income', 'Income value', 2), line('ebitda', 'EBITDA value', 4),
            ]}
          />
        </ChartCard>
      )
    case 'candles':
      return (
        <ChartCard title="Price candles" note="Monthly candles for now. Daily candles need a daily price history, which is not loaded yet.">
          <CandleChart bars={bars} />
        </ChartCard>
      )
    case 'ratios':
      return (
        <ChartCard title="Financial and operating ratios" note="Where each dollar of revenue went: cost of goods, operating expenses, everything else, and what was left as net income.">
          <TimeChart
            data={ratios.points} format={pct} fixedPercent
            series={[bar('cogs', 'Cost of goods', 5, 'stack'), bar('operating', 'Operating expenses', 2, 'stack'), bar('other', 'Other', 6, 'stack'), bar('netIncome', 'Net income', 3, 'stack')]}
          />
          {ratios.excluded.length > 0 && (
            <p className="message">
              Left out of the chart because a part was negative, so it would not add to 100%: {ratios.excluded.join(', ')}. They are in the table below.
            </p>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Period</th><th className="num">Cost of goods</th><th className="num">Operating</th><th className="num">Other</th><th className="num">Net income</th></tr></thead>
              <tbody>
                {[...ratios.table].reverse().map((r) => (
                  <tr key={r.label} className={r.extraordinary ? 'row-flag' : ''}>
                    <td>{r.label}{r.extraordinary && <span className="badge badge--warn" title="A part is negative">!</span>}</td>
                    <td className="num">{percent(r.cogs)}</td><td className="num">{percent(r.operating)}</td>
                    <td className="num">{percent(r.other)}</td><td className="num">{percent(r.netIncome)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )
  }
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {note && <p className="muted">{note}</p>}
      {children}
    </div>
  )
}
