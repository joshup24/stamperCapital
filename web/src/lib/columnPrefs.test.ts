import { describe, expect, it } from 'vitest'
import { moveBefore, reconcilePrefs, shiftColumn } from './columnPrefs'

const all = ['symbol', 'industry', 'price', 'gain', 'sector']

describe('reconcilePrefs', () => {
  it('gives the defaults when nothing is saved', () => {
    expect(reconcilePrefs(null, all, ['sector'])).toEqual({ order: all, hidden: ['sector'] })
  })

  it('keeps saved order and hidden columns', () => {
    const p = reconcilePrefs({ order: ['gain', 'symbol', 'price', 'industry', 'sector'], hidden: ['industry'] }, all, ['sector'])
    expect(p.order[0]).toBe('gain')
    expect(p.hidden).toEqual(['industry'])
  })

  it('drops unknown columns and appends new ones', () => {
    const p = reconcilePrefs({ order: ['gone', 'price', 'symbol'], hidden: [] }, all, [])
    expect(p.order).toEqual(['price', 'symbol', 'industry', 'gain', 'sector'])
  })

  it('a newly added column that is default-hidden stays hidden', () => {
    const p = reconcilePrefs({ order: ['symbol', 'price'], hidden: [] }, all, ['sector'])
    expect(p.hidden).toEqual(['sector'])
  })

  it('never hides a required column', () => {
    expect(reconcilePrefs({ order: all, hidden: ['symbol', 'price'] }, all, [], ['symbol']).hidden).toEqual(['price'])
  })

  it('survives garbage', () => {
    expect(reconcilePrefs({ order: 5, hidden: 'x' }, all, []).order).toEqual(all)
    expect(reconcilePrefs('nope', all, []).order).toEqual(all)
  })

  it('ignores duplicate saved keys', () => {
    expect(reconcilePrefs({ order: ['price', 'price', 'symbol'], hidden: [] }, all, []).order)
      .toEqual(['price', 'symbol', 'industry', 'gain', 'sector'])
  })
})

describe('moveBefore / shiftColumn', () => {
  it('moves a column in front of another, forwards and backwards', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveBefore(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'a', 'c', 'd'])
  })

  it('does nothing for the same or unknown column', () => {
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(moveBefore(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })

  it('shifts one step and stops at the ends', () => {
    expect(shiftColumn(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(shiftColumn(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(shiftColumn(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })
})
