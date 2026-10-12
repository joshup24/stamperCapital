import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../screener/DataContext'
import { useAuth } from '../auth/AuthProvider'
import { KIND_LABEL, normalizeName, parseMultiple, ruleProblem, type RuleKind } from '../../lib/multipleInput'
import { deleteMultiple, saveDefaultMultiple, saveMultiple } from './api'

const KINDS: RuleKind[] = ['category', 'industry', 'sector', 'ticker']
const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x).map((x) => x.toUpperCase()))].sort()

export default function MultiplesPage() {
  const { data, refreshSettings } = useData()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [kind, setKind] = useState<RuleKind>('category')
  const [name, setName] = useState('')
  const [mult, setMult] = useState('')
  const [defaultText, setDefaultText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const suggestions = useMemo(() => {
    if (!data) return []
    const c = data.components
    switch (kind) {
      case 'ticker': return c.map((x) => x.symbol).sort()
      case 'industry': return uniq(c.map((x) => x.industry))
      case 'sector': return uniq(c.map((x) => x.sector))
      case 'category':
        return uniq([...c.map((x) => x.category), ...Object.values(data.settings.userCategory), ...Object.keys(data.settings.user.category)])
    }
  }, [data, kind])

  if (!data) return <p className="message">Loading…</p>
  const { settings } = data
  const symbols = data.components.map((c) => c.symbol)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refreshSettings()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    const problem = ruleProblem(kind, name, mult, symbols)
    if (problem) { setError(problem); return }
    void run(async () => {
      await saveMultiple(userId, kind, normalizeName(name), parseMultiple(mult)!)
      setName('')
      setMult('')
    })
  }

  function saveDefault() {
    const m = parseMultiple(defaultText ?? '')
    if (m === null) { setError('Default multiple must be a number above 0.'); return }
    void run(async () => { await saveDefaultMultiple(userId, m); setDefaultText(null) })
  }

  function changeRule(k: RuleKind, n: string, text: string, current: number) {
    const m = parseMultiple(text)
    if (m === null) { setError(`${n}: multiple must be a number above 0.`); return }
    if (m !== current) void run(() => saveMultiple(userId, k, n, m))
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Your multiples</h1>
        <p className="muted">
          A stock uses the first rule that applies: its own multiple, then its category, then its industry, then its sector,
          then your default. Where you have set nothing, shared defaults apply. Changes show in the screener straight away.
        </p>
        {error && <p className="message message--error">{error}</p>}
      </div>

      <div className="card">
        <h2>Default</h2>
        <div className="inline-form">
          <label className="field">
            <span>Multiple for everything without a rule</span>
            <input
              inputMode="decimal"
              value={defaultText ?? String(settings.defaultMultiple)}
              onChange={(e) => setDefaultText(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy || defaultText === null} onClick={saveDefault}>Save default</button>
        </div>
      </div>

      <form className="card" onSubmit={add}>
        <h2>Add a rule</h2>
        <div className="inline-form">
          <label className="field">
            <span>Applies to</span>
            <select value={kind} onChange={(e) => { setKind(e.target.value as RuleKind); setName('') }}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{KIND_LABEL[kind]} name</span>
            <input list="rule-names" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'category' ? 'e.g. DEFENSE' : 'Start typing…'} />
            <datalist id="rule-names">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label className="field">
            <span>Multiple</span>
            <input inputMode="decimal" value={mult} onChange={(e) => setMult(e.target.value)} placeholder="e.g. 14" />
          </label>
          <button className="button" disabled={busy}>Add rule</button>
        </div>
      </form>

      {KINDS.map((k) => {
        const rules = Object.entries(settings.user[k]).sort(([a], [b]) => a.localeCompare(b))
        return (
          <div className="card" key={k}>
            <h2>{KIND_LABEL[k]} rules</h2>
            {rules.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <table className="table">
                <thead><tr><th>{KIND_LABEL[k]}</th><th className="num">Multiple</th><th aria-label="Remove" /></tr></thead>
                <tbody>
                  {rules.map(([n, m]) => (
                    <tr key={`${n}:${m}`}>
                      <td>{n}</td>
                      <td className="num">
                        <input
                          className="cell-input" inputMode="decimal" defaultValue={String(m)} disabled={busy}
                          onBlur={(e) => changeRule(k, n, e.target.value, m)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          aria-label={`Multiple for ${n}`}
                        />
                      </td>
                      <td><button className="button button--ghost" disabled={busy} onClick={() => run(() => deleteMultiple(k, n))}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
