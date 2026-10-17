import { describe, expect, it } from 'vitest'
import { creditToPercentText, normalizeName, parseCredit, parseMultiple, ruleProblem } from './multipleInput'

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

describe('parseCredit', () => {
  it('reads percentages as fractions, with or without a % sign', () => {
    expect(parseCredit('50')).toBe(0.5)
    expect(parseCredit(' 50% ')).toBe(0.5)
    expect(parseCredit('0')).toBe(0)
    expect(parseCredit('100')).toBe(1)
    expect(parseCredit('12.5')).toBe(0.125)
  })
  it('rejects empty, junk and anything outside 0 to 100', () => {
    for (const bad of ['', '  ', 'abc', '-1', '101', '1e9', 'NaN']) expect(parseCredit(bad)).toBeNull()
  })
  it('shows a fraction as a clean percent', () => {
    expect(creditToPercentText(0.5)).toBe('50')
    expect(creditToPercentText(0)).toBe('0')
    expect(creditToPercentText(0.125)).toBe('12.5')
  })
})
