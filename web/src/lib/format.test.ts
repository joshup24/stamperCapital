import { describe, expect, it } from 'vitest'
import { compactMoney } from './format'

describe('compactMoney', () => {
  it('always shows two decimals with the unit', () => {
    expect(compactMoney(7_335_358_000)).toBe('$7.34B')
    expect(compactMoney(1_000_000_000)).toBe('$1.00B')
    expect(compactMoney(12_340)).toBe('$12.34K')
    expect(compactMoney(2_535_354_000)).toBe('$2.54B')
    expect(compactMoney(3_200_000_000_000)).toBe('$3.20T')
  })

  it('shows small amounts in full with two decimals', () => {
    expect(compactMoney(950)).toBe('$950.00')
    expect(compactMoney(0)).toBe('$0.00')
    expect(compactMoney(49.33)).toBe('$49.33')
  })

  it('never leaves a unit at 1000: rounding steps up to the next one', () => {
    expect(compactMoney(999_999)).toBe('$1.00M')
    expect(compactMoney(999_999_999)).toBe('$1.00B')
    expect(compactMoney(999.999)).toBe('$1.00K')
    expect(compactMoney(999_994)).toBe('$999.99K')
  })

  it('handles negatives and does not show a minus on something that rounds to zero', () => {
    expect(compactMoney(-1_500_000)).toBe('-$1.50M')
    expect(compactMoney(-25_000_000_000)).toBe('-$25.00B')
    expect(compactMoney(-0.001)).toBe('$0.00')
  })

  it('plain counts have no dollar sign (shares)', () => {
    expect(compactMoney(44_592_000, false)).toBe('44.59M')
    expect(compactMoney(1_763_462_000, false)).toBe('1.76B')
  })

  it('missing stays a dash', () => {
    expect(compactMoney(null)).toBe('–')
    expect(compactMoney(null, false)).toBe('–')
  })
})
