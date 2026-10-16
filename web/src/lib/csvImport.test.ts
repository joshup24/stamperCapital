import { describe, expect, it } from 'vitest'
import { matchKnown, normalizeSymbol, parseImport, splitCsv } from './csvImport'

describe('splitCsv', () => {
  it('handles quotes, escaped quotes, commas inside quotes and mixed line endings', () => {
    const t = 'a,b\r\n"x, y","say ""hi"""\r\nlast,row'
    expect(splitCsv(t)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['last', 'row']])
  })
  it('reads tab-separated text pasted from Excel and drops blank lines', () => {
    expect(splitCsv('symbol\tcategory\n\nMO\tSIN\n')).toEqual([['symbol', 'category'], ['MO', 'SIN']])
  })
  it('ignores the Excel byte-order mark', () => {
    expect(splitCsv('﻿symbol,group\nMO,X')[0][0]).toBe('symbol')
  })
})

describe('normalizeSymbol', () => {
  it('upper-cases and uses dashes', () => {
    expect(normalizeSymbol(' brk.b ')).toBe('BRK-B')
  })
})

describe('parseImport', () => {
  it('reads symbol, category and group in any column order and case', () => {
    const p = parseImport('Group,SYMBOL,Category\nmyers, mo ,sin\n')
    expect(p.problems).toEqual([])
    expect(p.rows).toEqual([{ symbol: 'MO', category: 'SIN', group: 'MYERS' }])
    expect(p.hasCategory && p.hasGroup).toBe(true)
  })

  it('works with category only, and with ticker as the column name', () => {
    const p = parseImport('ticker,category\nLMT,Defense\nNOC,defense')
    expect(p.rows.map((r) => [r.symbol, r.category, r.group])).toEqual([['LMT', 'DEFENSE', null], ['NOC', 'DEFENSE', null]])
    expect(p.hasGroup).toBe(false)
  })

  it('needs a symbol column and a category or group column', () => {
    expect(parseImport('name,category\nx,y').problems[0].message).toMatch(/symbol/)
    expect(parseImport('symbol\nMO').problems[0].message).toMatch(/category/)
    expect(parseImport('').problems[0].message).toMatch(/empty/)
  })

  it('reports bad rows with their line numbers and keeps the good ones', () => {
    const p = parseImport('symbol,category\nMO,SIN\n,SIN\nbad symbol!,SIN\nPM,\nLMT,DEF')
    expect(p.rows.map((r) => r.symbol)).toEqual(['MO', 'LMT'])
    expect(p.problems.map((x) => x.line)).toEqual([3, 4, 5])
  })

  it('drops exact duplicate rows', () => {
    expect(parseImport('symbol,group\nMO,A\nMO,A\nMO,B').rows).toHaveLength(2)
  })
})

describe('matchKnown', () => {
  it('splits rows into stocks that exist and symbols that do not', () => {
    const rows = [
      { symbol: 'MO', category: 'A', group: null },
      { symbol: 'ZZZ', category: 'A', group: null },
      { symbol: 'ZZZ', category: null, group: 'G' },
    ]
    const r = matchKnown(rows, new Set(['MO']))
    expect(r.ok.map((x) => x.symbol)).toEqual(['MO'])
    expect(r.unknown).toEqual(['ZZZ'])
  })
})
