import { describe, expect, it } from 'vitest'
import { isAlert, valuate } from './valuation'

// The Power BI "Equity Summary" as it stood on 2024-07-19 (the 24 rows Joshua shared), checked against our
// valuation functions. Each row is rounded in the report, so comparisons allow for display rounding.
// Columns: symbol, possible gain, Mult-Cust, price, Value, V of Inc, VoI - Price, V of Ass, V of Div, Alert 1, Alert 2
// (null = blank in the report). The report's multiple was 11 for every row used below.
type Row = [string, number, number | null, number, number, number, number, number, number | null, number, number]

const ROWS: Row[] = [
  ['BRK-B', -0.007, 11.1, 441.82, 438.6, 304.4, -137.37, 134.1, null, -307.7, -307.7],
  ['CE', 0.18, 9.6, 143.52, 169.3, 198.0, 54.45, -59.4, 30.8, -203.0, -172.2],
  ['CINF', 0.854, 1.8, 126.01, 233.7, 129.1, 3.12, 72.7, 31.8, -53.3, -21.5],
  ['CNI', 0.299, 5.2, 121.11, 157.3, 82.0, -39.08, 40.7, 34.6, -80.4, -45.8],
  ['CP', -0.393, 18.8, 83.28, 50.5, 46.3, -36.98, -4.1, 8.3, -87.4, -79.1],
  ['CRH', -0.414, 18.1, 79.63, 46.6, 46.0, -33.62, 0.1, 0.5, -79.5, -79.0],
  ['CTSO', -6.31, null, 1.04, -5.5, -5.8, -6.82, 0.3, null, -0.8, -0.8],
  ['CVX', 0.463, 4.4, 161.97, 236.9, 126.2, -35.76, 43.5, 67.2, -118.5, -51.3],
  ['ESLT', -0.221, 19.4, 182.15, 141.8, 53.0, -129.13, 66.8, 22.0, -115.3, -93.3],
  ['IMO', 0.959, 3.6, 69.94, 137.0, 100.3, 30.39, 14.0, 22.6, -55.9, -33.3],
  ['LMT', -0.131, 13.2, 476.0, 413.7, 317.2, -158.83, -43.5, 140.1, -519.5, -379.4],
  ['MKL', 0.665, 3.8, 1613.03, 2686.5, 1658.1, 45.08, 924.5, 103.8, -688.5, -584.7],
  ['MO', 0.582, 4.8, 49.33, 78.1, 50.7, 1.38, -14.9, 42.3, -64.3, -22.0],
  ['NHI', 0.015, 8.9, 72.38, 73.5, 28.8, -43.57, 5.1, 39.6, -67.3, -27.7],
  ['PM', -0.188, 15.0, 107.46, 87.3, 55.4, -52.08, -24.5, 56.4, -132.0, -75.5],
  ['RGR', 1.63, -15.2, 44.23, 116.3, 30.1, -14.08, 16.9, 69.3, -27.3, 42.0],
  ['RIO', 1.232, -2.0, 64.37, 143.7, 67.0, 2.68, 33.1, 43.6, -31.3, 12.3],
  ['TPL', -0.056, 35.6, 816.96, 771.1, 581.8, -235.14, 45.9, 143.4, -771.1, -627.7],
  ['TSN', -1.109, null, 60.43, -6.6, -20.3, -80.77, -7.3, 21.0, -67.7, -46.7],
  ['TTE', 1.326, -0.2, 69.29, 161.2, 90.0, 20.72, 37.2, 34.0, -32.1, 1.9],
  ['UNP', -0.385, 20.0, 243.01, 149.5, 115.1, -127.92, -22.8, 57.2, -265.9, -208.6],
  ['VTR', -0.327, null, 53.21, 35.8, -1.1, -54.33, 17.2, 19.8, -36.0, -16.3],
  ['WELL', -0.296, 66.0, 105.95, 74.6, 6.6, -99.32, 43.4, 24.6, -62.6, -38.0],
  ['XOM', 0.39, 5.8, 118.8, 165.2, 99.8, -19.05, 22.6, 42.9, -96.2, -53.4],
]

// Rows whose income value in the report was built on a multiple of 11 (the others used a custom one), so the
// break-even multiple can be rebuilt from the report's own rounded figures.
const ELEVEN = ['BRK-B', 'CE', 'CINF', 'CP', 'ESLT', 'IMO', 'LMT', 'MKL', 'MO', 'PM', 'RGR', 'RIO', 'UNP', 'XOM', 'CVX']

const run = (r: Row) => {
  const [, , , price, , vinc, , vass, vdiv] = r
  return valuate({
    multiple: 11,
    assetsPerShare: vass,
    netIncomePerShare: vinc / 11,
    ebitdaPerShare: null,
    dividendsPerShare: vdiv === null ? null : vdiv / 11,
    price,
  })
}

describe('parity with the Power BI Equity Summary (2024-07-19)', () => {
  it('Value = V of Inc + V of Div + V of Ass for all 24 rows', () => {
    for (const r of ROWS) expect(run(r).intrinsic, r[0]).toBeCloseTo(r[4], 0) // within 0.5
  })

  it('Possible Gain matches', () => {
    for (const r of ROWS.filter((x) => x[0] !== 'CTSO')) expect(run(r).possibleGain!, r[0]).toBeCloseTo(r[1], 2)
  })

  it('VoI - Price = income value minus price', () => {
    for (const r of ROWS) expect(run(r).voiMinusPrice!, r[0]).toBeCloseTo(r[6], 0)
  })

  it('Alert 1 = assets value minus price', () => {
    for (const r of ROWS) expect(run(r).alert1!, r[0]).toBeCloseTo(r[9], 0)
  })

  it('Alert 2 = assets + dividend value minus price', () => {
    for (const r of ROWS) expect(run(r).alert2!, r[0]).toBeCloseTo(r[10], 0)
  })

  it('Alert 2 is above zero for exactly the three highlighted rows, and Alert 1 for none', () => {
    expect(ROWS.filter((r) => isAlert(run(r).alert2)).map((r) => r[0])).toEqual(['RGR', 'RIO', 'TTE'])
    expect(ROWS.filter((r) => isAlert(run(r).alert1))).toEqual([])
  })

  it('Mult-Cust (break-even multiple) matches where the report used a multiple of 11', () => {
    for (const r of ROWS.filter((x) => ELEVEN.includes(x[0]))) {
      expect(run(r).breakEvenMultiple!, r[0]).toBeGreaterThan(r[2]! - 0.35)
      expect(run(r).breakEvenMultiple!, r[0]).toBeLessThan(r[2]! + 0.35)
    }
  })

  it('Mult-Cust is blank for the rows with negative net income (CTSO, TSN, VTR)', () => {
    for (const r of ROWS.filter((x) => x[2] === null)) expect(run(r).breakEvenMultiple, r[0]).toBeNull()
  })
})
