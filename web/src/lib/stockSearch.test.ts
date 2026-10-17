import { describe, expect, it } from 'vitest'
import { highlight, matchStocks, matchesQuery } from './stockSearch'

const options = [
  { symbol: 'AAPL', label: 'AAPL · Apple Inc' },
  { symbol: 'BRK-B', label: 'BRK-B · Berkshire Hathaway' },
  { symbol: 'MO', label: 'MO · Altria Group' },
  { symbol: 'MOS', label: 'MOS · Mosaic Company' },
  { symbol: 'ALL', label: 'ALL · Allstate' },
  { symbol: 'PM', label: 'PM · Philip Morris International' },
  { symbol: 'XOM', label: 'XOM · Exxon Mobil' },
  { symbol: 'IMO', label: 'IMO · Imperial Oil Ltd' },
  { symbol: 'FCX', label: 'FCX · Freeport-McMoRan Copper & Gold Inc' },
  { symbol: 'THR', label: 'THR · Thermon Group Holdings' },
]
const syms = (q: string) => matchStocks(options, q).map((o) => o.symbol)

describe('matchStocks', () => {
  it('an empty query lists everything in the given order', () => {
    expect(syms('')).toEqual(options.map((o) => o.symbol))
    expect(syms('   ')).toEqual(options.map((o) => o.symbol))
  })

  it('ranks an exact symbol first, then symbols that start with it', () => {
    // PM ("Morris") and XOM ("Mobil") both match on the start of a name word, so they tie and sort A to Z
    expect(syms('mo')).toEqual(['MO', 'MOS', 'PM', 'XOM'])
  })

  it('matches partial text anywhere in the symbol or the company name', () => {
    expect(syms('hath')).toEqual(['BRK-B'])
    expect(syms('morris')).toEqual(['PM'])
    expect(syms('exx')).toEqual(['XOM'])
  })

  it('short searches match only the start of a symbol or name word, never the middle', () => {
    // no IMO (symbol contains "mo"), no FCX (McMoRan), no THR (Thermon)
    expect(syms('mo')).not.toContain('IMO')
    expect(syms('mo')).not.toContain('FCX')
    expect(syms('mo')).not.toContain('THR')
    // ALL (symbol starts "al") then MO (Altria starts "al"); "International" only has "al" inside
    expect(syms('al')).toEqual(['ALL', 'MO'])
  })

  it('from 3 letters, text inside a word matches too, ranked last', () => {
    expect(syms('oran')).toEqual(['FCX'])
    expect(syms('mob')).toEqual(['XOM'])
    expect(syms('ermo')).toEqual(['THR'])
    expect(syms('mor').slice(0, 1)).toEqual(['PM'])
  })

  it('matches each typed word against a single word, never across a space', () => {
    // "ph" would have matched the p of "Group" + the h of "Holdings" if the words were glued together
    expect(syms('ph in')).toEqual(['PM'])
    expect(syms('th g')).toEqual(['THR'])
    // a short word must start something, so "er g" finds nothing even though Thermon contains "er"
    expect(syms('er g')).toEqual([])
  })

  it('ignores case, spaces and punctuation', () => {
    expect(syms('brk b')).toEqual(['BRK-B'])
    expect(syms('BRKB')).toEqual(['BRK-B'])
    expect(syms('Brk-B')).toEqual(['BRK-B'])
  })

  it('every word typed must match', () => {
    expect(syms('philip morris')).toEqual(['PM'])
    expect(syms('philip exxon')).toEqual([])
  })

  it('finds nothing for text that matches nothing', () => {
    expect(syms('zzzz')).toEqual([])
  })

  it('respects the limit', () => {
    expect(matchStocks(options, '', 3)).toHaveLength(3)
  })
})

describe('matchesQuery', () => {
  it('empty text matches everything; otherwise partial symbol or name', () => {
    expect(matchesQuery('MO', 'Altria Group', '')).toBe(true)
    expect(matchesQuery('MO', 'Altria Group', 'altr')).toBe(true)
    expect(matchesQuery('MO', 'Altria Group', 'xyz')).toBe(false)
    expect(matchesQuery('BRK-B', null, 'brk b')).toBe(true)
    expect(matchesQuery('MO', null, 'altria')).toBe(false)
  })
})

describe('highlight', () => {
  const joined = (p: { text: string }[]) => p.map((x) => x.text).join('')
  const hits = (label: string, q: string) => highlight(label, q).filter((p) => p.hit).map((p) => p.text)

  it('bolds the start of the matching word and keeps all the text', () => {
    const p = highlight('PM · Philip Morris International', 'mo')
    expect(joined(p)).toBe('PM · Philip Morris International')
    expect(hits('PM · Philip Morris International', 'mo')).toEqual(['Mo'])
  })

  it('prefers the start of a word over the middle', () => {
    // "Mobil", not the "OM" at the end of XOM
    expect(hits('XOM · Exxon Mobil Corp', 'mo')).toEqual(['Mo'])
  })

  it('marks every typed word, ignoring case', () => {
    expect(hits('PM · Philip Morris International', 'PHILIP int')).toEqual(['Philip', 'Int'])
  })

  it('shows middle matches when that is all there is', () => {
    expect(hits('THR · Thermon Group Holdings', 'ermo')).toEqual(['ermo'])
  })

  it('leaves a label alone when nothing visible matched, or the query is empty', () => {
    expect(highlight('BRK-B · Berkshire', 'brkb')).toEqual([{ text: 'BRK-B · Berkshire', hit: false }])
    expect(highlight('MO · Altria', '')).toEqual([{ text: 'MO · Altria', hit: false }])
  })
})
