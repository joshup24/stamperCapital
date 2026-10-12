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

/** 23,494,000,000 -> "23.49B". Missing -> dash. Pass money = false for plain counts. */
export function compactMoney(n: Num, money = true): string {
  if (n === null) return dash
  const s = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  return money ? `${sign}$${s}` : `${sign}${s}`
}
