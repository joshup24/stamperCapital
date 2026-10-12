import { useMemo } from 'react'
import { checkScore, supportingChecks, yearChange, type CheckResult, type YearRow } from '../../lib/financials'
import { compactMoney, money, percent, signClass } from '../../lib/format'
import type { Num } from '../../lib/valuation'

interface Line {
  label: string
  get: (y: YearRow) => Num
  kind: 'money' | 'perShare' | 'count'
}

// What each statement panel shows. Adding a line = adding an entry here.
const PANELS: { title: string; lines: Line[] }[] = [
  {
    title: 'Income statement',
    lines: [
      { label: 'Revenue', get: (y) => y.revenue, kind: 'money' },
      { label: 'Cost of goods sold', get: (y) => y.cogs, kind: 'money' },
      { label: 'Operating expenses', get: (y) => y.operatingExpenses, kind: 'money' },
      { label: 'EBITDA', get: (y) => y.ebitda, kind: 'money' },
      { label: 'Net income', get: (y) => y.netIncome, kind: 'money' },
      { label: 'Net income / share', get: (y) => y.netIncomePerShare, kind: 'perShare' },
    ],
  },
  {
    title: 'Balance sheet',
    lines: [
      { label: 'Total assets', get: (y) => y.totalAssets, kind: 'money' },
      { label: 'Total liabilities', get: (y) => y.totalLiabilities, kind: 'money' },
      { label: 'Shareholder equity', get: (y) => y.equity, kind: 'money' },
      { label: 'Cash', get: (y) => y.cash, kind: 'money' },
      { label: 'Long-term debt', get: (y) => y.longTermDebt, kind: 'money' },
      { label: 'Shares outstanding', get: (y) => y.shares, kind: 'count' },
      { label: 'Value of assets / share', get: (y) => y.assetsPerShare, kind: 'perShare' },
    ],
  },
  {
    title: 'Cash flow',
    lines: [
      { label: 'Operating cash flow', get: (y) => y.operatingCashflow, kind: 'money' },
      { label: 'Capital expenditures', get: (y) => y.capex, kind: 'money' },
      { label: 'Free cash flow', get: (y) => y.freeCashflow, kind: 'money' },
      { label: 'Dividends paid', get: (y) => y.dividends, kind: 'money' },
      { label: 'Financing cash flow', get: (y) => y.financingCashflow, kind: 'money' },
      { label: 'Dividends / share', get: (y) => y.dividendsPerShare, kind: 'perShare' },
    ],
  },
]

const fmt = (kind: Line['kind'], n: Num) =>
  kind === 'money' ? compactMoney(n) : kind === 'count' ? compactMoney(n, false) : money(n)

const STATUS_MARK: Record<CheckResult['status'], string> = { pass: '✓', fail: '✗', unknown: '?' }

interface Props {
  /** annual years, oldest first */
  years: YearRow[]
}

/** Supporting checks and the three statement panels. */
export default function SummaryTab({ years }: Props) {
  const checks = useMemo(() => supportingChecks(years), [years])
  const score = checkScore(checks)
  const latest = years[years.length - 1]
  const prior = years[years.length - 2]

  return (
    <div className="stack">
      <div className="card">
        <div className="panel-head">
          <h2>Supporting checks</h2>
          <span className="muted">{score.passed} of {score.known} known checks pass{score.known < score.total ? ` (${score.total - score.known} unknown)` : ''}</span>
        </div>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.key} className={`check-item check-item--${c.status}`}>
              <span className="check-item__mark" aria-hidden>{STATUS_MARK[c.status]}</span>
              <span><strong>{c.label}</strong><br /><span className="muted">{c.detail}</span></span>
            </li>
          ))}
        </ul>
        <p className="muted">These are provisional. The list is meant to be replaced with your own definitions.</p>
      </div>


      {!latest && <p className="message">No annual statements for this stock.</p>}

      {latest && (
        <div className="panels">
          {PANELS.map((p) => (
            <div className="card" key={p.title}>
              <h2>{p.title}</h2>
              <p className="muted">Fiscal years ending {latest.date}{prior ? ` and ${prior.date}` : ''}. USD.</p>
              <table className="table">
                <thead>
                  <tr><th /><th className="num">Latest</th><th className="num">Prior</th><th className="num">Change</th></tr>
                </thead>
                <tbody>
                  {p.lines.map((l) => {
                    const now = l.get(latest)
                    const before = prior ? l.get(prior) : null
                    const ch = yearChange(now, before)
                    return (
                      <tr key={l.label}>
                        <td>{l.label}</td>
                        <td className="num">{fmt(l.kind, now)}</td>
                        <td className="num muted">{fmt(l.kind, before)}</td>
                        <td className={`num ${signClass(ch)}`}>{percent(ch)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
