// What the stock dropdown lists, and which stock the "Stock" tab reopens. Pure, so it is tested.

export interface StockOption {
  symbol: string
  label: string
}

interface Named {
  symbol: string
  name: string | null
}

/**
 * Dropdown entries, A to Z by symbol, as "MO · Altria Group". The current symbol is always
 * included, even if it has no data, so the dropdown never shows a blank selection.
 */
export function stockOptions(stocks: Named[], current: string | null): StockOption[] {
  const seen = new Set<string>()
  const out: StockOption[] = []
  for (const s of stocks) {
    if (seen.has(s.symbol)) continue
    seen.add(s.symbol)
    out.push({ symbol: s.symbol, label: s.name ? `${s.symbol} · ${s.name}` : s.symbol })
  }
  if (current && !seen.has(current)) out.push({ symbol: current, label: current })
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol, 'en'))
}

const KEY = 'stamper.lastStock'

/** The stock last opened in this browser, if any. */
export function readLastStock(): string | null {
  try {
    const v = localStorage.getItem(KEY)
    return v && /^[A-Z0-9-]{1,12}$/.test(v) ? v : null
  } catch {
    return null
  }
}

export function rememberStock(symbol: string) {
  try { localStorage.setItem(KEY, symbol) } catch { /* storage unavailable: nothing to remember */ }
}

/** Forget the remembered stock (the box was cleared), so the Stock tab opens empty. */
export function forgetStock() {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable: nothing to forget */ }
}

/** Link for a stock, keeping the chosen tab (?tab=ratios) when moving between stocks. */
export function stockPath(symbol: string, search = ''): string {
  return `/stock/${encodeURIComponent(symbol)}${search}`
}
