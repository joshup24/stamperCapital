// Checks what the user types before it is saved. Pure, so it can be tested.

export const MAX_MULTIPLE = 200

/** "12", "12.5", " 8 " -> number. Empty, zero, negative, junk or absurd -> null. */
export function parseMultiple(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MULTIPLE) return null
  return n
}

/** Names are stored upper case with single spaces ("Tobacco  " -> "TOBACCO"). */
export function normalizeName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toUpperCase()
}

export type RuleKind = 'ticker' | 'category' | 'industry' | 'sector'

export const KIND_LABEL: Record<RuleKind, string> = {
  ticker: 'Stock',
  category: 'Category',
  industry: 'Industry',
  sector: 'Sector',
}

/** Why a new rule can't be saved, or null if it can. */
export function ruleProblem(kind: RuleKind, name: string, multipleText: string, knownSymbols: string[]): string | null {
  if (normalizeName(name) === '') return `Enter a ${KIND_LABEL[kind].toLowerCase()} name.`
  if (kind === 'ticker' && !knownSymbols.includes(normalizeName(name))) return `${normalizeName(name)} is not a stock in your data.`
  if (parseMultiple(multipleText) === null) return `Multiple must be a number above 0 and up to ${MAX_MULTIPLE}.`
  return null
}
