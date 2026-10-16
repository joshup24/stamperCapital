import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from '../screener/DataContext'
import { loadTickerSymbols } from '../screener/load'
import { matchKnown, parseImport } from '../../lib/csvImport'
import { applyImport } from '../multiples/api'

const EXAMPLE = 'symbol,category,group\nLMT,DEFENSE,MYERS\nNOC,DEFENSE,\nBRK-B,INSURANCE,MYERS\n'

/** Tag many stocks at once: paste or upload a CSV of symbol, category and/or group. */
export default function ImportPage() {
  const { refreshSettings } = useData()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [text, setText] = useState('')
  const [known, setKnown] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    loadTickerSymbols().then(setKnown).catch((e: Error) => setResult({ text: e.message, error: true }))
  }, [])

  const parsed = useMemo(() => (text.trim() ? parseImport(text) : null), [text])
  const matched = useMemo(() => (parsed && known ? matchKnown(parsed.rows, known) : null), [parsed, known])

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((t) => { setText(t); setResult(null) })
    e.target.value = ''
  }

  async function apply() {
    if (!matched || matched.ok.length === 0) return
    setBusy(true)
    setResult(null)
    try {
      const r = await applyImport(userId, matched.ok)
      await refreshSettings()
      setResult({ text: `Saved: ${r.categories} categories and ${r.memberships} group memberships.`, error: false })
      setText('')
    } catch (e) {
      setResult({ text: (e as Error).message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Import categories and groups</h1>
        <p className="muted">
          Paste rows from Excel or upload a CSV. The first row must have a <code>symbol</code> column plus a{' '}
          <code>category</code> and/or <code>group</code> column. Existing categories for the same stocks are replaced;
          group memberships are added to what you already have.
        </p>
        <pre className="example">{EXAMPLE}</pre>
        <div className="inline-form">
          <label className="field">
            <span>Upload a CSV file</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} />
          </label>
        </div>
        <label className="field">
          <span>Or paste here</span>
          <textarea className="paste" rows={8} value={text} onChange={(e) => { setText(e.target.value); setResult(null) }} placeholder={EXAMPLE} />
        </label>
      </div>

      {result && <p className={`message ${result.error ? 'message--error' : ''}`} role="status">{result.text}</p>}

      {parsed && (
        <div className="card">
          <h2>Preview</h2>
          {parsed.problems.length > 0 && (
            <>
              <p className="message message--error">{parsed.problems.length} row{parsed.problems.length === 1 ? '' : 's'} cannot be used:</p>
              <ul>
                {parsed.problems.slice(0, 15).map((p) => <li key={p.line}>Line {p.line}: {p.message}</li>)}
                {parsed.problems.length > 15 && <li>…and {parsed.problems.length - 15} more.</li>}
              </ul>
            </>
          )}
          {matched && matched.unknown.length > 0 && (
            <p className="message">
              Not in your database yet, so skipped ({matched.unknown.length}): {matched.unknown.slice(0, 30).join(', ')}
              {matched.unknown.length > 30 ? '…' : ''}. A stock must be added to the data load first.
            </p>
          )}
          {matched && (
            <>
              <p>{matched.ok.length} row{matched.ok.length === 1 ? '' : 's'} ready to save.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Symbol</th>{parsed.hasCategory && <th>Category</th>}{parsed.hasGroup && <th>Group</th>}</tr></thead>
                  <tbody>
                    {matched.ok.slice(0, 50).map((r, i) => (
                      <tr key={`${r.symbol}-${i}`}>
                        <td>{r.symbol}</td>{parsed.hasCategory && <td>{r.category ?? '–'}</td>}{parsed.hasGroup && <td>{r.group ?? '–'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {matched.ok.length > 50 && <p className="muted">Showing the first 50 of {matched.ok.length}.</p>}
              <p><button className="button" disabled={busy || matched.ok.length === 0} onClick={apply}>
                {busy ? 'Saving…' : `Save ${matched.ok.length} rows`}
              </button></p>
            </>
          )}
          {!known && <p className="muted">Checking which stocks exist…</p>}
        </div>
      )}
    </div>
  )
}
