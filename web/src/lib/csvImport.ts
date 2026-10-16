// Reads a CSV of "symbol, category, group" into rows ready to save, and says what is wrong with
// the rest. Pure functions, so they are tested. Nothing here talks to the network.
//
// Accepted: a header row with `symbol` plus `category` and/or `group` (any order, any case),
// commas or tabs, quoted values, Excel's byte-order mark, Windows or Mac line endings.
// Symbols are tidied the way the app spells them: upper case, BRK.B -> BRK-B.

export interface ImportRow {
  symbol: string
  category: string | null
  group: string | null
}

export interface ImportProblem {
  line: number
  message: string
}

export interface ParsedImport {
  rows: ImportRow[]
  problems: ImportProblem[]
  hasCategory: boolean
  hasGroup: boolean
}

export function normalizeSymbol(text: string): string {
  return text.trim().toUpperCase().replace(/\./g, '-')
}

const tidy = (text: string | undefined): string | null => {
  const v = (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  return v === '' ? null : v
}

/** Splits one CSV or tab-separated text into rows of cells, honouring quotes. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const delimiter = src.split('\n', 1)[0].includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      row.push(cell); cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else {
      cell += c
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function parseImport(text: string): ParsedImport {
  const table = splitCsv(text)
  const empty: ParsedImport = { rows: [], problems: [], hasCategory: false, hasGroup: false }
  if (table.length === 0) return { ...empty, problems: [{ line: 1, message: 'The file is empty.' }] }

  const header = table[0].map((h) => h.trim().toLowerCase())
  const iSym = header.findIndex((h) => h === 'symbol' || h === 'ticker')
  const iCat = header.indexOf('category')
  const iGrp = header.indexOf('group')
  if (iSym < 0) return { ...empty, problems: [{ line: 1, message: 'The first row must have a "symbol" column.' }] }
  if (iCat < 0 && iGrp < 0) return { ...empty, problems: [{ line: 1, message: 'Add a "category" and/or a "group" column.' }] }

  const rows: ImportRow[] = []
  const problems: ImportProblem[] = []
  const seen = new Set<string>()

  table.slice(1).forEach((cells, k) => {
    const line = k + 2
    const symbol = normalizeSymbol(cells[iSym] ?? '')
    const category = iCat >= 0 ? tidy(cells[iCat]) : null
    const group = iGrp >= 0 ? tidy(cells[iGrp]) : null
    if (symbol === '') { problems.push({ line, message: 'No symbol.' }); return }
    if (!/^[A-Z0-9]+(-[A-Z0-9]{1,3})?$/.test(symbol)) { problems.push({ line, message: `"${symbol}" does not look like a stock symbol.` }); return }
    if (category === null && group === null) { problems.push({ line, message: `${symbol}: no category or group given.` }); return }
    const key = `${symbol}|${category ?? ''}|${group ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ symbol, category, group })
  })

  return { rows, problems, hasCategory: iCat >= 0, hasGroup: iGrp >= 0 }
}

/** Splits parsed rows into those we can save (the stock exists) and those we cannot. */
export function matchKnown(rows: ImportRow[], known: Set<string>): { ok: ImportRow[]; unknown: string[] } {
  const ok: ImportRow[] = []
  const unknown = new Set<string>()
  for (const r of rows) {
    if (known.has(r.symbol)) ok.push(r)
    else unknown.add(r.symbol)
  }
  return { ok, unknown: [...unknown].sort() }
}
