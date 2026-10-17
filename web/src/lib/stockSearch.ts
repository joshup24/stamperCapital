// Type-ahead matching for stocks, shared by the stock picker and the screener search.
// Pure functions, so they are tested. Matching ignores case, spaces and punctuation, so
// "brk b", "BRK-B" and "brkb" all find BRK-B, and partial text matches anywhere.
import type { StockOption } from './stockOptions'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The company name part of an option label ("MO · Altria Group" -> "Altria Group"). */
const nameOf = (o: StockOption) => {
  const i = o.label.indexOf(' · ')
  return i < 0 ? '' : o.label.slice(i + 3)
}

/** Every space-separated word of the query must appear in the symbol or the name. */
function tokens(query: string): string[] {
  return query.split(/\s+/).map(norm).filter(Boolean)
}

/**
 * Lower is better; null means no match. Short searches (1-2 letters) match only the START of a
 * symbol or of a word in the name, so "mo" finds MO and "Morris", not "Thermon". From 3 letters
 * the text may also appear inside a symbol or word, ranked last.
 */
function score(symbol: string, name: string, query: string): number | null {
  const ts = tokens(query)
  if (ts.length === 0) return null
  const sym = norm(symbol)
  const nm = norm(name)
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

  // Each typed word is matched against the symbol or ONE word of the name, never across a space
  // ("ph" must not match the "p" of "Group" plus the "h" of "Holdings").
  const startsSomething = (t: string) => sym.startsWith(t) || words.some((w) => w.startsWith(t))
  const insideSomething = (t: string) => sym.includes(t) || words.some((w) => w.includes(t))
  // short words (1-2 letters) must match a start; longer ones may match inside
  if (!ts.every((t) => (t.length >= 3 ? insideSomething(t) : startsSomething(t)))) return null

  const joined = ts.join('')
  if (sym === joined) return 0
  if (sym.startsWith(joined)) return 1
  if (nm.startsWith(joined)) return 2
  if (ts.every(startsSomething)) return 3
  return sym.includes(ts[0]) ? 4 : 5
}

/**
 * Options that match what was typed, best first: exact symbol, symbol starts with, name starts with,
 * a name word starts with, then (3+ letters only) inside a symbol, inside a name. Empty query lists everything.
 */
export function matchStocks(options: StockOption[], query: string, limit = 60): StockOption[] {
  if (tokens(query).length === 0) return options.slice(0, limit)
  const scored: { o: StockOption; s: number }[] = []
  for (const o of options) {
    const s = score(o.symbol, nameOf(o), query)
    if (s !== null) scored.push({ o, s })
  }
  scored.sort((a, b) => a.s - b.s || a.o.symbol.localeCompare(b.o.symbol, 'en'))
  return scored.slice(0, limit).map((x) => x.o)
}

/** Same rule for filtering the screener table: does this stock match the typed text? */
export function matchesQuery(symbol: string, name: string | null, query: string): boolean {
  if (tokens(query).length === 0) return true
  return score(symbol, name ?? '', query) !== null
}

/** A piece of a label, and whether it is the part that matched what was typed. */
export interface Piece {
  text: string
  hit: boolean
}

/**
 * Splits a label so the matched letters can be shown in bold. Each typed word is looked for at the
 * start of a word first, then anywhere (ignoring case). Text that matches only through ignored
 * punctuation (typing "brkb" for "BRK-B") is simply not highlighted.
 */
export function highlight(label: string, query: string): Piece[] {
  const lower = label.toLowerCase()
  const marks: [number, number][] = []
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    let at = -1
    for (let i = lower.indexOf(raw); i >= 0; i = lower.indexOf(raw, i + 1)) {
      if (i === 0 || /[^a-z0-9]/.test(lower[i - 1])) { at = i; break } // prefer the start of a word
      if (at < 0) at = i
    }
    if (at >= 0) marks.push([at, at + raw.length])
  }
  marks.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const m of marks) {
    const last = merged[merged.length - 1]
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1])
    else merged.push([m[0], m[1]])
  }
  const out: Piece[] = []
  let pos = 0
  for (const [s, e] of merged) {
    if (s > pos) out.push({ text: label.slice(pos, s), hit: false })
    out.push({ text: label.slice(s, e), hit: true })
    pos = e
  }
  if (pos < label.length) out.push({ text: label.slice(pos), hit: false })
  return out.length ? out : [{ text: label, hit: false }]
}
