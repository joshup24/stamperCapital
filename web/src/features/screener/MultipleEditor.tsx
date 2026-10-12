import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from './DataContext'
import { normalizeName, parseMultiple } from '../../lib/multipleInput'
import { deleteMultiple, saveCategory, saveMultiple } from '../multiples/api'
import type { ScreenerRow } from '../../lib/screener'

/** Edit this one stock's multiple and category from the details popup. */
export default function MultipleEditor({ row }: { row: ScreenerRow }) {
  const { data, refreshSettings } = useData()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const own = data?.settings.user.ticker[row.symbol]

  const [mult, setMult] = useState(own === undefined ? '' : String(own))
  const [category, setCategory] = useState(data?.settings.userCategory[row.symbol] ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const categories = [...new Set([
    ...(data?.components.map((c) => c.category) ?? []),
    ...Object.values(data?.settings.userCategory ?? {}),
    ...Object.keys(data?.settings.user.category ?? {}),
  ].filter((x): x is string => !!x).map((x) => x.toUpperCase()))].sort()

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

  function saveMult() {
    const m = parseMultiple(mult)
    if (m === null) { setError('Multiple must be a number above 0.'); return }
    void run(() => saveMultiple(userId, 'ticker', row.symbol, m))
  }

  function clearMult() {
    void run(async () => { await deleteMultiple('ticker', row.symbol); setMult('') })
  }

  function saveCat() {
    const c = normalizeName(category)
    void run(() => saveCategory(userId, row.symbol, c === '' ? null : c))
  }

  return (
    <div className="editor">
      <h3>Your settings for {row.symbol}</h3>
      <p className="muted">Now using {row.multiple} (from {row.multipleSource}).</p>
      {error && <p className="message message--error">{error}</p>}
      <div className="inline-form">
        <label className="field">
          <span>Multiple for this stock</span>
          <input inputMode="decimal" value={mult} onChange={(e) => setMult(e.target.value)} placeholder="no own multiple" />
        </label>
        <button className="button" disabled={busy} onClick={saveMult}>Save</button>
        <button className="button button--ghost" disabled={busy || own === undefined} onClick={clearMult}>Clear</button>
      </div>
      <div className="inline-form">
        <label className="field">
          <span>Category</span>
          <input list="editor-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. DEFENSE" />
          <datalist id="editor-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <button className="button" disabled={busy} onClick={saveCat}>Save category</button>
      </div>
    </div>
  )
}
