// Loads one stock's statement history and shapes it for lib/financials.ts.
import { supabase } from '../../lib/supabase'
import { DEFAULT_CREDITS, type AssetCredits, type StatementRow } from '../../lib/financials'
import type { PriceBar } from '../../lib/prices'

type Raw = Record<string, unknown>

const NOT_NUMERIC = new Set([
  'symbol', 'period', 'fiscal_date_ending', 'year_month', 'currency', 'reported_currency',
  'fx_rate', 'overridden_fields', 'fetched_at', 'reported_date', 'report_time',
])

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toStatementRow(r: Raw): StatementRow {
  const v: Record<string, number | null> = {}
  for (const [k, x] of Object.entries(r)) if (!NOT_NUMERIC.has(k)) v[k] = num(x)
  return {
    date: String(r.fiscal_date_ending),
    yearMonth: String(r.year_month),
    fx: num(r.fx_rate),
    v,
  }
}

async function statements(table: string, symbol: string, period: 'annual' | 'quarterly'): Promise<StatementRow[]> {
  const out: StatementRow[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from(table).select('*').eq('symbol', symbol).eq('period', period)
      .order('fiscal_date_ending', { ascending: true }).range(from, from + size - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Raw[]).map(toStatementRow))
    if (!data || data.length < size) break
  }
  return out
}

export interface StockHistory {
  income: StatementRow[]
  balance: StatementRow[]
  cash: StatementRow[]
  credits: AssetCredits
}

export async function loadStockHistory(symbol: string, period: 'annual' | 'quarterly' = 'annual'): Promise<StockHistory> {
  const [income, balance, cash, param] = await Promise.all([
    statements('income_statement', symbol, period),
    statements('balance_sheet', symbol, period),
    statements('cash_flow', symbol, period),
    supabase.from('valuation_param').select('intangibles_credit,ppe_credit').maybeSingle(),
  ])
  const p = param.data as { intangibles_credit: unknown; ppe_credit: unknown } | null
  const credits: AssetCredits = {
    intangibles: num(p?.intangibles_credit) ?? DEFAULT_CREDITS.intangibles,
    ppe: num(p?.ppe_credit) ?? DEFAULT_CREDITS.ppe,
  }
  return { income, balance, cash, credits }
}

/** Monthly price bars including your price corrections, oldest first. */
export async function loadPriceBars(symbol: string): Promise<PriceBar[]> {
  const out: PriceBar[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('price_monthly_effective')
      .select('month,open,high,low,close,adjusted_close,dividend_amount')
      .eq('symbol', symbol)
      .order('month', { ascending: true })
      .range(from, from + size - 1)
    if (error) throw new Error(`prices: ${error.message}`)
    for (const r of (data ?? []) as Raw[]) {
      out.push({
        month: String(r.month),
        open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
        adjustedClose: num(r.adjusted_close), dividend: num(r.dividend_amount),
      })
    }
    if (!data || data.length < size) break
  }
  return out
}
