import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../../components/Modal'
import { supabase } from '../../lib/supabase'
import { compactMoney, money, percent } from '../../lib/format'
import type { ScreenerRow } from '../../lib/screener'
import MultipleEditor from './MultipleEditor'

interface Overview {
  name: string | null
  exchange: string | null
  country: string | null
  currency: string | null
  sector: string | null
  industry: string | null
  fiscal_year_end: string | null
  latest_quarter: string | null
  market_cap: string | number | null
  shares_outstanding: string | number | null
  description: string | null
}

const compact = (v: string | number | null, asMoney = false) => {
  if (v === null) return '–'
  const n = Number(v)
  return Number.isFinite(n) ? compactMoney(n, asMoney) : '–'
}

export default function DetailsModal({ row, onClose }: { row: ScreenerRow; onClose: () => void }) {
  const [o, setO] = useState<Overview | null | undefined>(undefined) // undefined = loading
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    supabase
      .from('company_overview')
      .select('name,exchange,country,currency,sector,industry,fiscal_year_end,latest_quarter,market_cap,shares_outstanding,description')
      .eq('symbol', row.symbol)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return
        if (error) setError(error.message)
        setO((data as Overview | null) ?? null)
      })
    return () => { live = false }
  }, [row.symbol])

  const v = row.valuation
  const items: [string, string][] = [
    ['Exchange', o?.exchange ?? '–'],
    ['Country', o?.country ?? '–'],
    ['Currency', o?.currency ?? '–'],
    ['Sector', o?.sector ?? row.sector ?? '–'],
    ['Industry', o?.industry ?? row.industry ?? '–'],
    ['Your category', row.category ?? '–'],
    ['Market cap', compact(o?.market_cap ?? null, true)],
    ['Shares outstanding', compact(o?.shares_outstanding ?? null)],
    ['Fiscal year end', o?.fiscal_year_end ?? '–'],
    ['Latest quarter', o?.latest_quarter ?? '–'],
    ['Balance sheet date', row.balanceSheetDate ?? '–'],
    ['Price date', row.priceDate ?? '–'],
  ]

  return (
    <Modal title={`${row.symbol}${o?.name ? ` · ${o.name}` : ''}`} onClose={onClose}>
      {error && <p className="message message--error">Could not load overview: {error}</p>}
      {o === undefined && <p className="muted">Loading…</p>}

      <dl className="facts">
        {items.map(([k, val]) => (
          <div key={k}><dt>{k}</dt><dd>{val}</dd></div>
        ))}
      </dl>

      <h3>Your valuation</h3>
      <dl className="facts">
        <div><dt>Multiple</dt><dd>{row.multiple} ({row.multipleSource})</dd></div>
        <div><dt>Price</dt><dd>{money(row.price)}</dd></div>
        <div><dt>Assets / share</dt><dd>{money(v.assetsValue)}</dd></div>
        <div><dt>Income value</dt><dd>{money(v.incomeValue)}</dd></div>
        <div><dt>Dividend value</dt><dd>{money(v.dividendValue)}</dd></div>
        <div><dt>Value / share</dt><dd>{money(v.intrinsic)}</dd></div>
        <div><dt>Possible gain</dt><dd>{percent(v.possibleGain)}</dd></div>
      </dl>

      <MultipleEditor row={row} />

      {o?.description && <p className="modal__description">{o.description}</p>}

      <p><Link className="button" to={`/stock/${row.symbol}`}>Open {row.symbol}</Link></p>
    </Modal>
  )
}
