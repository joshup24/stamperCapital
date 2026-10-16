import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useData } from './DataContext'
import { normalizeName } from '../../lib/multipleInput'
import { addToGroup, removeFromGroup, saveCategories } from '../multiples/api'

interface Props {
  /** symbols of the selected rows */
  symbols: string[]
  categories: string[]
  groups: string[]
  onClear: () => void
}

/** Tag the selected stocks with a category, or add them to / remove them from a group. */
export default function BulkBar({ symbols, categories, groups, onClear }: Props) {
  const { refreshSettings } = useData()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [category, setCategory] = useState('')
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  const n = symbols.length

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      await refreshSettings()
      setMessage({ text: `${label}: ${n} stock${n === 1 ? '' : 's'}.`, error: false })
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true })
    } finally {
      setBusy(false)
    }
  }

  const cat = normalizeName(category)
  const grp = normalizeName(group)

  return (
    <div className="bulk" role="region" aria-label="Bulk tagging">
      <strong>{n} selected</strong>
      <div className="inline-form">
        <label className="field">
          <span>Category</span>
          <input list="bulk-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. DEFENSE" />
          <datalist id="bulk-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <button className="button" disabled={busy || cat === ''} onClick={() => run(`Category ${cat} set`, () => saveCategories(userId, symbols, cat))}>Set category</button>
        <button className="button button--ghost" disabled={busy} onClick={() => run('Category removed', () => saveCategories(userId, symbols, null))}>Remove category</button>
      </div>
      <div className="inline-form">
        <label className="field">
          <span>Group</span>
          <input list="bulk-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="existing or new" />
          <datalist id="bulk-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <button className="button" disabled={busy || grp === ''} onClick={() => run(`Added to ${grp}`, () => addToGroup(userId, grp, symbols))}>Add to group</button>
        <button className="button button--ghost" disabled={busy || grp === ''} onClick={() => run(`Removed from ${grp}`, () => removeFromGroup(grp, symbols))}>Remove from group</button>
      </div>
      <button className="button button--ghost" onClick={onClear}>Clear selection</button>
      {message && <p className={`message ${message.error ? 'message--error' : ''}`} role="status">{message.text}</p>}
    </div>
  )
}
