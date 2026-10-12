import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useData } from '../screener/DataContext'
import { buildRow } from '../../lib/screener'
import { buildYears } from '../../lib/financials'
import type { PriceBar } from '../../lib/prices'
import { money, percent } from '../../lib/format'
import Gauge from '../../components/Gauge'
import Tabs from '../../components/Tabs'
import SummaryTab from './SummaryTab'
import ChartsTab, { CHART_TABS, PERIOD_CHARTS, type ChartKey } from './ChartsTab'
import { loadPriceBars, loadStockHistory, type StockHistory } from './load'
import type { Period } from './chartData'

const TABS = [{ key: 'summary', label: 'Summary' }, ...CHART_TABS]
const isTab = (k: string | null): k is string => !!k && TABS.some((t) => t.key === k)

/** The key makes React start fresh when you move to a different stock. */
export default function StockPage() {
  const { symbol = '' } = useParams()
  return <StockView key={symbol} symbol={symbol} />
}

function StockView({ symbol }: { symbol: string }) {
  const { data } = useData()
  const [params, setParams] = useSearchParams()
  const tab = isTab(params.get('tab')) ? params.get('tab')! : 'summary'
  const [period, setPeriod] = useState<Period>('annual')
  const [histories, setHistories] = useState<Partial<Record<Period, StockHistory>>>({})
  const [bars, setBars] = useState<PriceBar[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requested = useRef(new Set<Period>())

  const usesPeriod = PERIOD_CHARTS.includes(tab as ChartKey)
  const wanted: Period = usesPeriod ? period : 'annual'

  // Annual statements always (summary, checks and the yearly charts need them), plus quarterly on request.
  useEffect(() => {
    for (const p of new Set<Period>(['annual', wanted])) {
      if (requested.current.has(p)) continue
      requested.current.add(p)
      loadStockHistory(symbol, p)
        .then((h) => setHistories((cur) => ({ ...cur, [p]: h })))
        .catch((e: Error) => setError(e.message))
    }
  }, [symbol, wanted])

  useEffect(() => {
    loadPriceBars(symbol).then(setBars).catch((e: Error) => setError(e.message))
  }, [symbol])

  const component = data?.components.find((c) => c.symbol === symbol)
  const row = useMemo(
    () => (data && component ? buildRow(component, data.settings, 'fy') : null),
    [data, component],
  )

  const build = (h?: StockHistory) => (h ? buildYears(h.income, h.balance, h.cash, h.credits) : null)
  const annual = useMemo(() => build(histories.annual), [histories.annual])
  const selected = useMemo(() => build(histories[wanted]), [histories, wanted])

  if (!data) return <p className="message">Loading…</p>
  if (!component || !row) {
    return <div className="card"><p>No data for {symbol}.</p><Link to="/">Back to screener</Link></div>
  }

  const v = row.valuation

  return (
    <div className="stack">
      <div className="card stock-head">
        <div>
          <p><Link to="/">← Screener</Link></p>
          <h1>{symbol}{component.name ? ` · ${component.name}` : ''}</h1>
          <p className="muted">{[component.industry, component.sector].filter(Boolean).join(' · ') || '–'}</p>
          <dl className="facts facts--tight">
            <div><dt>Price</dt><dd>{money(row.price)}</dd></div>
            <div><dt>Your multiple</dt><dd>{row.multiple} ({row.multipleSource})</dd></div>
            <div><dt>Value / share</dt><dd>{money(v.intrinsic)}</dd></div>
            <div><dt>Income value</dt><dd>{money(v.incomeValue)}</dd></div>
            <div><dt>Dividend value</dt><dd>{money(v.dividendValue)}</dd></div>
            <div><dt>Assets / share</dt><dd>{money(v.assetsValue)}</dd></div>
          </dl>
        </div>
        <Gauge value={v.possibleGain} label="Possible gain" display={percent(v.possibleGain)} />
      </div>

      <div className="card">
        <div className="panel-head">
          <Tabs tabs={TABS} active={tab} onChange={(k) => setParams(k === 'summary' ? {} : { tab: k })} />
          <span className="app-header__spacer" />
          {usesPeriod && (
            <label className="field field--inline">
              <span>Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <p className="message message--error">Could not load data: {error}</p>}

      {tab === 'summary' ? (
        annual ? <SummaryTab years={annual} /> : !error && <p className="message">Loading statements…</p>
      ) : selected && annual && bars ? (
        selected.length === 0
          ? <p className="message">No {wanted} statements for {symbol}.</p>
          : <ChartsTab chart={tab as ChartKey} period={wanted} years={selected} annual={annual} bars={bars} multiple={row.multiple} />
      ) : (
        !error && <p className="message">Loading…</p>
      )}
    </div>
  )
}
