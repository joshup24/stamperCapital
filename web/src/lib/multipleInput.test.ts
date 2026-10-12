import { describe, expect, it } from 'vitest'
import { normalizeName, parseMultiple, ruleProblem } from './multipleInput'

describe('parseMultiple', () => {
  it('accepts normal numbers', () => {
    expect(parseMultiple('12')).toBe(12)
    expect(parseMultiple(' 8.5 ')).toBe(8.5)
  })
  it('rejects empty, zero, negative, junk and absurd values', () => {
    for (const bad of ['', '  ', '0', '-3', 'abc', '1e9', '201', 'NaN', 'Infinity']) {
      expect(parseMultiple(bad)).toBeNull()
    }
  })
})

describe('normalizeName', () => {
  it('upper-cases and tidies spaces', () => {
    expect(normalizeName('  oil   & gas ')).toBe('OIL & GAS')
  })
})

describe('ruleProblem', () => {
  const symbols = ['MO', 'AAPL']
  it('accepts a good rule', () => {
    expect(ruleProblem('industry', 'tobacco', '9', symbols)).toBeNull()
    expect(ruleProblem('ticker', 'mo', '9', symbols)).toBeNull()
  })
  it('catches a missing name, unknown stock and bad multiple', () => {
    expect(ruleProblem('category', '  ', '9', symbols)).toMatch(/name/)
    expect(ruleProblem('ticker', 'ZZZZ', '9', symbols)).toMatch(/not a stock/)
    expect(ruleProblem('sector', 'energy', '0', symbols)).toMatch(/Multiple/)
  })
})
