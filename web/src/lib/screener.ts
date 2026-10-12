// Turns the database's per-share building blocks into screener rows for ONE user,
// applying that user's multiples, categories and groups. Pure functions, no network.

import { resolveMultiple, valuate, type MultipleSource, type Num, type ValuationResult } from './valuation'

export type Basis = 'fy' | 'ttm'

/** Income-side figures per share for one basis (last full year, or trailing four quarters). */
export interface IncomePerShare {
  netIncome: Num
  ebitda: Num
  dividends: Num
}

/** One row of the screener_components view, numbers already converted. */
export interface Component {
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  category: string | null
  price: Num
  priceDate: string | null
  assetsPerShare: Num
  fy: IncomePerShare
  ttm: IncomePerShare
  balanceSheetDate: string | null
  anyOverridden: boolean
  fxMissing: boolean
}

type Rules = Record<string, number>

/** Everything that makes the numbers "this user's". Names are upper case. */
export interface UserSettings {
  defaultMultiple: number
  user: { ticker: Rules; category: Rules; industry: Rules; sector: Rules }
  /** Shared rules (multiple_rule): used where the user has set nothing at that level. */
  shared: { category: Rules; industry: Rules; sector: Rules }
  /** The user's own category per symbol; beats the shared ticker.category. */
  userCategory: Record<string, string>
  /** group name -> symbols, already merged (shared groups plus the user's own). */
  groups: Record<string, string[]>
}

export interface ScreenerRow {
  symbol: string
  name: string | null
  sector: string | null
  industry: string | null
  category: string | null
  price: Num
  priceDate: string | null
  multiple: number
  multipleSource: MultipleSource
  valuation: ValuationResult
  anyOverridden: boolean
  fxMissing: boolean
  balanceSheetDate: string | null
}

const up = (s: string | null) => (s ? s.toUpperCase() : null)

export function buildRow(c: Component, s: UserSettings, basis: Basis): ScreenerRow {
  const category = s.userCategory[c.symbol] ?? up(c.category)
  const industry = up(c.industry)
  const sector = up(c.sector)

  const pick = (userRules: Rules, sharedRules: Rules | null, key: string | null) =>
    key == null ? null : (userRules[key] ?? sharedRules?.[key] ?? null)

  const choice = resolveMultiple({
    ticker: s.user.ticker[c.symbol] ?? null,
    category: pick(s.user.category, s.shared.category, category),
    industry: pick(s.user.industry, s.shared.industry, industry),
    sector: pick(s.user.sector, s.shared.sector, sector),
    fallback: s.defaultMultiple,
  })

  const inc = basis === 'fy' ? c.fy : c.ttm
  const valuation = valuate({
    multiple: choice.multiple,
    assetsPerShare: c.assetsPerShare,
    netIncomePerShare: inc.netIncome,
    ebitdaPerShare: inc.ebitda,
    dividendsPerShare: inc.dividends,
    price: c.price,
  })

  return {
    symbol: c.symbol,
    name: c.name,
    sector: c.sector,
    industry: c.industry,
    category,
    price: c.price,
    priceDate: c.priceDate,
    multiple: choice.multiple,
    multipleSource: choice.source,
    valuation,
    anyOverridden: c.anyOverridden,
    fxMissing: c.fxMissing,
    balanceSheetDate: c.balanceSheetDate,
  }
}

// ---------------------------------------------------------------------------
// Screening tests. Each is "this piece of value, per share, is above the price".
// A row with missing data never passes a test (and never fails it either: it is
// simply excluded when that test is switched on, so gaps stay visible, not hidden as 0).
// ---------------------------------------------------------------------------

export type TestKey = 'assets' | 'income' | 'ebitda' | 'total'

export const TESTS: { key: TestKey; label: string }[] = [
  { key: 'assets', label: 'Assets per share above price' },
  { key: 'income', label: 'Net income value above price' },
  { key: 'ebitda', label: 'EBITDA value above price' },
  { key: 'total', label: 'Total value above price' },
]

export function passes(row: ScreenerRow, test: TestKey): boolean {
  const { price, valuation: v } = row
  if (price === null || price <= 0) return false
  const piece: Num =
    test === 'assets' ? v.assetsValue
    : test === 'income' ? v.incomeValue
    : test === 'ebitda' ? v.ebitdaValue
    : v.intrinsic
  return piece !== null && piece > price
}

export interface Filters {
  group: string | null
  sector: string | null
  industry: string | null
  tests: TestKey[]
  /** Minimum possible gain as a fraction (0.2 = 20%); null = no minimum. */
  minGain: number | null
  search: string
}

export const NO_FILTERS: Filters = { group: null, sector: null, industry: null, tests: [], minGain: null, search: '' }

export function applyFilters(rows: ScreenerRow[], f: Filters, groups: Record<string, string[]>): ScreenerRow[] {
  const inGroup = f.group ? new Set(groups[f.group] ?? []) : null
  const q = f.search.trim().toUpperCase()
  return rows.filter((r) => {
    if (inGroup && !inGroup.has(r.symbol)) return false
    if (f.sector && r.sector !== f.sector) return false
    if (f.industry && r.industry !== f.industry) return false
    if (q && !r.symbol.includes(q) && !(r.name ?? '').toUpperCase().includes(q)) return false
    if (f.minGain !== null) {
      const g = r.valuation.possibleGain
      if (g === null || g < f.minGain) return false
    }
    return f.tests.every((t) => passes(r, t))
  })
}

/** Sort by a number, with missing values always last whatever the direction. */
export function sortByNumber<T>(items: T[], get: (t: T) => Num, descending: boolean): T[] {
  return [...items].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return descending ? y - x : x - y
  })
}

/** Sort by a number or a text value; missing values are always last whatever the direction. */
export function sortBy<T>(items: T[], get: (t: T) => Num | string, descending: boolean): T[] {
  return [...items].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    const c = typeof x === 'string' || typeof y === 'string'
      ? String(x).localeCompare(String(y), 'en', { sensitivity: 'base' })
      : x - y
    return descending ? -c : c
  })
}
