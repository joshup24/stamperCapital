import { describe, expect, it } from 'vitest'
import { forgetStock, readLastStock, rememberStock, stockOptions, stockPath } from './stockOptions'

describe('stockOptions', () => {
  const stocks = [
    { symbol: 'MO', name: 'Altria Group' },
    { symbol: 'AAPL', name: 'Apple Inc' },
    { symbol: 'XYZ', name: null },
    { symbol: 'MO', name: 'Altria again' },
  ]

  it('sorts A to Z, labels with the name, and drops duplicates', () => {
    expect(stockOptions(stocks, null)).toEqual([
      { symbol: 'AAPL', label: 'AAPL · Apple Inc' },
      { symbol: 'MO', label: 'MO · Altria Group' },
      { symbol: 'XYZ', label: 'XYZ' },
    ])
  })

  it('includes the current symbol even when it has no data', () => {
    const out = stockOptions(stocks, 'BFB')
    expect(out.map((o) => o.symbol)).toEqual(['AAPL', 'BFB', 'MO', 'XYZ'])
    expect(out.find((o) => o.symbol === 'BFB')?.label).toBe('BFB')
  })

  it('does not duplicate the current symbol when it is already listed', () => {
    expect(stockOptions(stocks, 'MO').filter((o) => o.symbol === 'MO')).toHaveLength(1)
  })

  it('handles an empty list', () => {
    expect(stockOptions([], null)).toEqual([])
  })
})

describe('stockPath', () => {
  it('keeps the tab and encodes odd symbols', () => {
    expect(stockPath('MO')).toBe('/stock/MO')
    expect(stockPath('BRK-B', '?tab=ratios')).toBe('/stock/BRK-B?tab=ratios')
    expect(stockPath('A/B')).toBe('/stock/A%2FB')
  })
})

describe('last stock memory', () => {
  it('returns null when storage is unavailable or empty (as in a plain test environment)', () => {
    expect(readLastStock()).toBeNull()
    expect(() => rememberStock('MO')).not.toThrow()
    expect(() => forgetStock()).not.toThrow()
  })
})
