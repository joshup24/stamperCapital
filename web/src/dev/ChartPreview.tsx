// Dev-only page (/dev/charts): every chart with made-up data and no login. Used to check how
// charts look, and later to preview a new brand (colors, fonts) without touching real data.
import { useMemo, useState } from 'react'
import { buildYears, type StatementRow } from '../lib/financials'
import type { PriceBar } from '../lib/prices'
import Tabs from '../components/Tabs'
import Gauge from '../components/Gauge'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import AppHeader from '../components/AppHeader'
import ChartsTab, { CHART_TABS, type ChartKey } from '../features/stock/ChartsTab'
import { percent } from '../lib/format'

const row = (date: string, v: Record<string, number | null>): StatementRow => ({
  date, yearMonth: date.slice(0, 7) + '-01', fx: 1, v,
})

function fakeYears() {
  const income: StatementRow[] = []
  const balance: StatementRow[] = []
  const cash: StatementRow[] = []
  for (let i = 0; i < 12; i++) {
    const date = `${2012 + i}-12-31`
    const revenue = 20e9 + i * 0.4e9
    const loss = i === 7
    income.push(row(date, {
      total_revenue: revenue, costof_goods_and_services_sold: revenue * 0.3, operating_expenses: revenue * 0.02,
      net_income: loss ? -revenue * 0.05 : revenue * (0.2 + i * 0.01), ebitda: revenue * 0.4,
    }))
    balance.push(row(date, {
      total_assets: 40e9 - i * 0.5e9, intangible_assets: 15e9, property_plant_equipment: 2e9,
      total_liabilities: 42e9 - i * 0.3e9, common_stock_shares_outstanding: 2e9 - i * 0.03e9,
      total_shareholder_equity: -2e9, cash_and_cash_equivalents_at_carrying_value: 3e9, long_term_debt: 25e9,
    }))
    cash.push(row(date, {
      operating_cashflow: 8e9 + i * 0.1e9, capital_expenditures: 0.2e9, dividend_payout: 6e9 + i * 0.1e9, cashflow_from_financing: -5e9,
    }))
  }
  return buildYears(income, balance, cash)
}

function fakeBars(): PriceBar[] {
  const bars: PriceBar[] = []
  let p = 30
  for (let i = 0; i < 12 * 12; i++) {
    const y = 2012 + Math.floor(i / 12)
    const m = String((i % 12) + 1).padStart(2, '0')
    const open = p
    p = Math.max(5, p + Math.sin(i / 5) * 2 + (i % 7 === 0 ? -1.5 : 0.6))
    bars.push({
      month: `${y}-${m}-01`, open, close: p, high: Math.max(open, p) + 1.5, low: Math.min(open, p) - 1.5,
      adjustedClose: p, dividend: i % 3 === 2 ? 0.9 + (y - 2012) * 0.05 : null,
    })
  }
  return bars
}

export default function ChartPreview() {
  const [chart, setChart] = useState<ChartKey>('balance')
  const [period, setPeriod] = useState<'annual' | 'quarterly'>('annual')
  const years = useMemo(() => fakeYears(), [])
  const bars = useMemo(() => fakeBars(), [])

  return (
    <>
    <AppHeader email="you@example.com" onSignOut={() => {}} />
    <main className="app-main stack">
      <div className="card">
        <div className="panel-head">
          <Logo variant="horizontal" width={300} />
          <span className="app-header__spacer" />
          <ThemeToggle />
        </div>
        <h1>Chart preview (made-up data)</h1>
        <p className="muted">Dev only. Shows every chart with the current brand tokens.</p>
        <div className="stock-head">
          <Gauge value={0.42} label="Possible gain" display={percent(0.42)} />
          <Gauge value={-0.3} label="Possible gain" display={percent(-0.3)} />
          <Gauge value={null} label="Possible gain" display="–" />
        </div>
      </div>
      <div className="card">
        <div className="panel-head">
          <Tabs tabs={CHART_TABS} active={chart} onChange={(k) => setChart(k as ChartKey)} />
          <span className="app-header__spacer" />
          <label className="field field--inline">
            <span>Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as 'annual' | 'quarterly')}>
              <option value="annual">Annual</option><option value="quarterly">Quarterly</option>
            </select>
          </label>
        </div>
      </div>
      <ChartsTab chart={chart} period={period} years={years} annual={years} bars={bars} multiple={11} />
    </main>
    </>
  )
}
