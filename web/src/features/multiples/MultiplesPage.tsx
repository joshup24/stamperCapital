import { useMemo, useState, type FormEvent } from 'react'
import { useData } from '../screener/DataContext'
import { useAuth } from '../auth/AuthProvider'
import { KIND_LABEL, normalizeName, parseMultiple, ruleProblem, type RuleKind } from '../../lib/multipleInput'
import Modal from '../../components/Modal'
import { deleteMultiple, saveDefaultMultiple, saveMultiple } from './api'

/** Highest priority first: the first rule that applies to a stock wins. */
const KINDS: RuleKind[] = ['ticker', 'category', 'industry', 'sector']
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
  const [info, setInfo] = useState(false)

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
        <div className="panel-head">
          <h1>Your multiples</h1>
          <button className="icon-button" onClick={() => setInfo(true)} aria-label="How multiples are chosen" title="How multiples are chosen">ⓘ</button>
        </div>
        <p>
          The highest-priority rule that applies to a stock wins:
        </p>
        <ol className="priority">
          <li><strong>Stock</strong> <span className="muted">its own multiple</span></li>
          <li><strong>Category</strong> <span className="muted">your bucket, e.g. DEFENSE</span></li>
          <li><strong>Industry</strong></li>
          <li><strong>Sector</strong></li>
          <li><strong>Default</strong> <span className="muted">everything else</span></li>
        </ol>
        <p className="muted">Changes show in the screener straight away.</p>
        {error && <p className="message message--error">{error}</p>}
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
            <h2><span className="rank">{KINDS.indexOf(k) + 1}</span> {KIND_LABEL[k]} rules</h2>
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
      <div className="card">
        <h2><span className="rank">5</span> Default</h2>
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


      {info && <PriorityInfo onClose={() => setInfo(false)} />}
    </div>
  )
}

/** The detail behind the one-line summary, for people who want to know exactly how it works. */
function PriorityInfo({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How a multiple is chosen" onClose={onClose}>
      <p>
        For every stock the app walks down this list and uses the <strong>first</strong> multiple it finds.
        The screener shows where it came from: <code>t</code> stock, <code>c</code> category, <code>i</code> industry,
        <code>s</code> sector, and nothing for the default.
      </p>
      <ol>
        <li><strong>Stock.</strong> A multiple you set on one stock. It beats everything else.</li>
        <li><strong>Category.</strong> The stock's category is the one <em>you</em> gave it; if you gave none, the shared category
          from the database is used. Then your rule for that category applies, or a shared rule if you have none.</li>
        <li><strong>Industry.</strong> Matched on the company's industry (e.g. TOBACCO). Your rule first, then a shared one.</li>
        <li><strong>Sector.</strong> Matched on the company's sector (e.g. CONSUMER STAPLES). Your rule first, then a shared one.</li>
        <li><strong>Default.</strong> Your default multiple, or the shared default if you never set one.</li>
      </ol>
      <h3>Good to know</h3>
      <ul>
        <li>Within one level your own rule beats a shared rule for the same name.</li>
        <li>A category is a bucket that changes the numbers. A <em>group</em> only filters what you look at and never changes a multiple.</li>
        <li>Each stock has one category per person, but can be in many groups.</li>
        <li>Removing a rule never deletes data; the stock simply falls back to the next level.</li>
        <li>Multiples must be above 0 and at most 200.</li>
      </ul>
    </Modal>
  )
}
