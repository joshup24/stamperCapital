// Loads everything the screener needs from Supabase and shapes it for lib/screener.ts.
import { supabase } from '../../lib/supabase'
import type { Component, UserSettings } from '../../lib/screener'
import { DEFAULT_CREDITS } from '../../lib/financials'

type Raw = Record<string, unknown>

/** PostgREST sends numerics as strings; null stays null, junk becomes null. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** Reads every row of a table or view, a page at a time (the server caps a single reply). */
async function fetchAll(table: string, columns = '*'): Promise<Raw[]> {
  const size = 1000
  const out: Raw[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as unknown as Raw[]))
    if (!data || data.length < size) break
  }
  return out
}

function toComponent(r: Raw): Component {
  return {
    symbol: String(r.symbol),
    name: str(r.name),
    sector: str(r.sector),
    industry: str(r.industry),
    category: str(r.category),
    price: num(r.price),
    priceDate: str(r.price_date),
    assetsPerShare: num(r.assets_per_share),
    // absent on a database that has not had the v2 view yet: the app then falls back to assetsPerShare
    assetParts: 'total_assets_per_share' in r
      ? {
          totalAssets: num(r.total_assets_per_share),
          totalLiabilities: num(r.total_liabilities_per_share),
          intangibles: num(r.intangibles_per_share),
          ppe: num(r.ppe_per_share),
        }
      : null,
    shares: num(r.shares),
    currency: str(r.currency),
    fy: {
      netIncome: num(r.fy_net_income_per_share),
      netIncomeCont: num(r.fy_net_income_cont_per_share),
      ebitda: num(r.fy_ebitda_per_share),
      dividends: num(r.fy_dividends_per_share),
      revenue: num(r.fy_revenue),
    },
    ttm: {
      netIncome: num(r.ttm_net_income_per_share),
      netIncomeCont: num(r.ttm_net_income_cont_per_share),
      ebitda: num(r.ttm_ebitda_per_share),
      dividends: num(r.ttm_dividends_per_share),
      revenue: num(r.ttm_revenue),
    },
    balanceSheetDate: str(r.balance_sheet_date),
    anyOverridden: r.any_overridden === true,
    fxMissing: r.fx_missing === true,
  }
}

export interface ScreenerData {
  components: Component[]
  settings: UserSettings
}

export async function loadComponents(): Promise<Component[]> {
  return (await fetchAll('screener_components')).map(toComponent)
}

export async function loadScreenerData(): Promise<ScreenerData> {
  const [components, settings] = await Promise.all([loadComponents(), loadSettings()])
  return { components, settings }
}

/** The user's own multiples, categories and groups (plus shared ones as fallback). */
export async function loadSettings(): Promise<UserSettings> {
  const [userMult, sharedRules, setting, userCat, userGroups, sharedGroups, param] = await Promise.all([
    fetchAll('user_multiple'),
    fetchAll('multiple_rule'),
    fetchAll('user_setting'),
    fetchAll('user_ticker_category'),
    fetchAll('user_group'),
    fetchAll('ticker_group'),
    fetchAll('valuation_param'),
  ])

  const user = { ticker: {} as Record<string, number>, category: {} as Record<string, number>, industry: {} as Record<string, number>, sector: {} as Record<string, number> }
  for (const r of userMult) {
    const kind = r.kind as keyof typeof user
    const m = num(r.multiple)
    if (user[kind] && m !== null) user[kind][String(r.name)] = m
  }

  const shared = { category: {} as Record<string, number>, industry: {} as Record<string, number>, sector: {} as Record<string, number> }
  for (const r of sharedRules) {
    const kind = r.kind as keyof typeof shared
    const m = num(r.multiple)
    if (shared[kind] && m !== null) shared[kind][String(r.name)] = m
  }

  const userCategory: Record<string, string> = {}
  for (const r of userCat) userCategory[String(r.symbol)] = String(r.category)

  const sets: Record<string, Set<string>> = {}
  for (const r of [...sharedGroups, ...userGroups]) {
    const g = String(r.group_name)
    ;(sets[g] ??= new Set()).add(String(r.symbol))
  }
  const groups: Record<string, string[]> = {}
  for (const g of Object.keys(sets)) groups[g] = [...sets[g]]

  const defaultMultiple = num(setting[0]?.default_multiple) ?? num(param[0]?.default_multiple) ?? 11

  // How much of the balance sheet counts as value: the user's own setting, else the shared default.
  const sharedCredits = {
    intangibles: num(param[0]?.intangibles_credit) ?? DEFAULT_CREDITS.intangibles,
    ppe: num(param[0]?.ppe_credit) ?? DEFAULT_CREDITS.ppe,
  }
  const userCredits = { intangibles: num(setting[0]?.intangibles_credit), ppe: num(setting[0]?.ppe_credit) }
  const credits = {
    intangibles: userCredits.intangibles ?? sharedCredits.intangibles,
    ppe: userCredits.ppe ?? sharedCredits.ppe,
  }

  return { defaultMultiple, credits, sharedCredits, userCredits, user, shared, userCategory, groups }
}

/** Every stock the database knows (the ticker table), including ones without statements yet. */
export async function loadTickerSymbols(): Promise<Set<string>> {
  return new Set((await fetchAll('ticker', 'symbol')).map((r) => String(r.symbol)))
}
