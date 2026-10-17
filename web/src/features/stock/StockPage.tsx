import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useData } from '../screener/DataContext'
import { buildRow } from '../../lib/screener'
import { buildYears } from '../../lib/financials'
import type { PriceBar } from '../../lib/prices'
import { money, percent } from '../../lib/format'
import Gauge from '../../components/Gauge'
import Tabs from '../../components/Tabs'
import FilterSelect from '../../components/FilterSelect'
import StockPicker from './StockPicker'
import { forgetStock, readLastStock, rememberStock, stockOptions, stockPath } from '../../lib/stockOptions'
import SummaryTab from './SummaryTab'
import ChartsTab, { CHART_TABS, PERIOD_CHARTS, type ChartKey } from './ChartsTab'
import { loadPriceBars, loadStockHistory, type StockHistory } from './load'
import type { Period } from './chartData'

const TABS = [{ key: 'summary', label: 'Summary' }, ...CHART_TABS]
const isTab = (k: string | null): k is string => !!k && TABS.some((t) => t.key === k)

/** The key makes React start fresh when you move to a different stock. */
export default function StockPage() {
  const { symbol } = useParams()
  if (!symbol) return <StockIndex />
  return <StockView key={symbol} symbol={symbol} />
}

/** The "Stock" tab with no stock chosen: reopen the last one, or ask for one. */
function StockIndex() {
  const { data } = useData()
  const navigate = useNavigate()
  if (!data) return <p className="message">Loading…</p>
  const last = readLastStock()
  if (last && data.components.some((c) => c.symbol === last)) return <Navigate to={stockPath(last)} replace />
  return (
    <div className="card">
      <h1>Stock detail</h1>
      <p className="muted">Pick a stock, or open one from the screener with its → button.</p>
      <StockPicker symbol={null} options={stockOptions(data.components, null)} onChange={(s) => navigate(stockPath(s))} />
    </div>
  )
}

function StockView({ symbol }: { symbol: string }) {
  const { data } = useData()
  const navigate = useNavigate()
  const location = useLocation()
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

  useEffect(() => { rememberStock(symbol) }, [symbol])

  const component = data?.components.find((c) => c.symbol === symbol)
  const row = useMemo(
    () => (data && component ? buildRow(component, data.settings, 'fy') : null),
    [data, component],
  )

  // the user's own balance sheet credits, so charts agree with the screener
  const credits = data?.settings.credits
  const annual = useMemo(
    () => (histories.annual ? buildYears(histories.annual.income, histories.annual.balance, histories.annual.cash, credits ?? histories.annual.credits) : null),
    [histories.annual, credits],
  )
  const selected = useMemo(() => {
    const h = histories[wanted]
    return h ? buildYears(h.income, h.balance, h.cash, credits ?? h.credits) : null
  }, [histories, wanted, credits])

  if (!data) return <p className="message">Loading…</p>
  if (!component || !row) {
    return (
      <div className="card">
        <p>No data for {symbol}.</p>
        <StockPicker symbol={symbol} options={stockOptions(data.components, symbol)} onChange={(next) => navigate(stockPath(next, location.search))} onClear={() => { forgetStock(); navigate('/stock') }} />
        <p><Link to="/">Back to screener</Link></p>
      </div>
    )
  }

  const v = row.valuation

  return (
    <div className="stack">
      <div className="card stock-head">
        <div>
          <div className="stock-nav">
            <Link to="/">← Screener</Link>
            <StockPicker
              symbol={symbol}
              options={stockOptions(data.components, symbol)}
              onChange={(next) => navigate(stockPath(next, location.search))}
              onClear={() => { forgetStock(); navigate('/stock') }}
            />
          </div>
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
            <FilterSelect
              label="Period" value={period} defaultValue="annual" inline
              options={[{ value: 'annual', label: 'Annual' }, { value: 'quarterly', label: 'Quarterly' }]}
              onChange={(v) => setPeriod(v as Period)}
            />
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
