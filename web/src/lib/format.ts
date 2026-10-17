import type { Num } from './valuation'

const dash = '–'

export function money(n: Num, digits = 2): string {
  return n === null ? dash : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function percent(n: Num, digits = 1): string {
  return n === null ? dash : `${(n * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

export function signClass(n: Num): string {
  if (n === null || n === 0) return ''
  return n > 0 ? 'is-positive' : 'is-negative'
}

const UNITS = [
  { suffix: 'T', size: 1e12 },
  { suffix: 'B', size: 1e9 },
  { suffix: 'M', size: 1e6 },
  { suffix: 'K', size: 1e3 },
]

/**
 * Compact with ALWAYS two decimals: 23,494,000,000 -> "$23.49B", 1,000,000,000 -> "$1.00B", 950 -> "$950.00".
 * Rounding never leaves a value like "1000.00K": 999,999 becomes "$1.00M". Pass money = false for plain counts
 * such as shares ("44.59M"). Missing -> dash. A value that rounds to zero carries no minus sign.
 */
export function compactMoney(n: Num, money = true): string {
  if (n === null) return dash
  const abs = Math.abs(n)
  let body: string
  let i = UNITS.findIndex((u) => abs >= u.size) // largest unit that fits; -1 when under 1,000
  if (i === -1 && Number(abs.toFixed(2)) >= 1000) i = UNITS.length - 1 // 999.999 -> 1.00K
  if (i === -1) {
    body = abs.toFixed(2)
  } else {
    // if two-decimal rounding would reach 1000 of this unit, step up to the next bigger unit
    if (Number((abs / UNITS[i].size).toFixed(2)) >= 1000 && i > 0) i -= 1
    body = `${(abs / UNITS[i].size).toFixed(2)}${UNITS[i].suffix}`
  }
  const zero = Number.parseFloat(body) === 0
  return `${n < 0 && !zero ? '-' : ''}${money ? '$' : ''}${body}`
}
