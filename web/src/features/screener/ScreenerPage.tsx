import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from './DataContext'
import {
  NO_FILTERS, TESTS, applyFilters, buildRow, sortBy,
  type Basis, type Filters, type TestKey,
} from '../../lib/screener'
import { moveBefore, reconcilePrefs, type ColumnPrefs } from '../../lib/columnPrefs'
import { COLUMNS, COLUMN_KEYS, DEFAULT_HIDDEN, REQUIRED } from './columns'
import DetailsModal from './DetailsModal'
import ColumnPicker from './ColumnPicker'

const PREFS_KEY = 'stamper.screener.columns'
const COLLAPSE_KEY = 'stamper.screener.filtersCollapsed'
const byKey = Object.fromEntries(COLUMNS.map((c) => [c.key, c]))
const uniqueSorted = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort()

// Remembered per browser only; the page works fine if storage is unavailable.
function loadPrefs(): ColumnPrefs {
  let saved: unknown = null
  try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') } catch { /* ignore */ }
  return reconcilePrefs(saved, COLUMN_KEYS, DEFAULT_HIDDEN, REQUIRED)
}
function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
}
function savePrefs(p: ColumnPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

export default function ScreenerPage() {
  const { data, error, loadMs } = useData()
  const [basis, setBasis] = useState<Basis>('fy')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sortKey, setSortKey] = useState('gain')
  const [descending, setDescending] = useState(true)
  const [prefs, setPrefs] = useState<ColumnPrefs>(loadPrefs)
  const [dragging, setDragging] = useState<string | null>(null)
  const [detailsSymbol, setDetailsSymbol] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  const updatePrefs = (p: ColumnPrefs) => { setPrefs(p); savePrefs(p) }
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }

  const rows = useMemo(
    () => (data ? data.components.map((c) => buildRow(c, data.settings, basis)) : []),
    [data, basis],
  )

  const visible = useMemo(() => {
    if (!data) return []
    const filtered = applyFilters(rows, filters, data.settings.groups)
    const col = byKey[sortKey] ?? byKey.gain
    return sortBy(filtered, (r) => col.value(r) ?? (null as never), descending)
  }, [rows, data, filters, sortKey, descending])

  const detailsRow = detailsSymbol ? rows.find((r) => r.symbol === detailsSymbol) ?? null : null

  if (error) return <p className="message message--error">Could not load data: {error}</p>
  if (!data) return <p className="message">Loading…</p>

  const shown = prefs.order.filter((k) => !prefs.hidden.includes(k)).map((k) => byKey[k])

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const toggleTest = (t: TestKey) =>
    set({ tests: filters.tests.includes(t) ? filters.tests.filter((x) => x !== t) : [...filters.tests, t] })
  const clickSort = (k: string) => {
    if (k === sortKey) setDescending(!descending)
    else { setSortKey(k); setDescending(byKey[k].align === 'right') } // numbers high-first, text A-Z
  }
  const arrow = (k: string) => (k === sortKey ? (descending ? ' ▼' : ' ▲') : '')

  const active = [
    filters.search && `“${filters.search}”`,
    filters.group && `Group ${filters.group}`,
    filters.sector,
    filters.industry,
    basis === 'ttm' && 'Trailing four quarters',
    filters.minGain !== null && `Gain ≥ ${filters.minGain * 100}%`,
    ...filters.tests.map((t) => TESTS.find((x) => x.key === t)?.label),
  ].filter(Boolean) as string[]

  const groups = Object.keys(data.settings.groups).sort()
  const sectors = uniqueSorted(rows.map((r) => r.sector))
  const industries = uniqueSorted(
    rows.filter((r) => !filters.sector || r.sector === filters.sector).map((r) => r.industry),
  )

  return (
    <div className="stack">
      <div className="card">
        <div className="panel-head">
          <button className="caret" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? 'Show filters' : 'Hide filters'}>
            {collapsed ? '▸' : '▾'} Filters
          </button>
          {collapsed && <span className="muted panel-head__summary">{active.length ? active.join(' · ') : 'No filters'}</span>}
          <span className="app-header__spacer" />
          <button className="button button--ghost" disabled={active.length === 0} onClick={() => { setFilters(NO_FILTERS); setBasis('fy') }}>Clear filters</button>
          <button className="button button--ghost" onClick={() => setPicking(true)}>Columns</button>
        </div>
        {!collapsed && <div className="filters">
        <label className="field">
          <span>Search</span>
          <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Symbol or name" />
        </label>
        <label className="field">
          <span>Group</span>
          <select value={filters.group ?? ''} onChange={(e) => set({ group: e.target.value || null })}>
            <option value="">All</option>
            {groups.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sector</span>
          <select value={filters.sector ?? ''} onChange={(e) => set({ sector: e.target.value || null, industry: null })}>
            <option value="">All</option>
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Industry</span>
          <select value={filters.industry ?? ''} onChange={(e) => set({ industry: e.target.value || null })}>
            <option value="">All</option>
            {industries.map((i) => <option key={i}>{i}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Income basis</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="fy">Last full year</option>
            <option value="ttm">Trailing four quarters</option>
          </select>
        </label>
        <label className="field">
          <span>Min possible gain %</span>
          <input
            type="number" step="5" value={filters.minGain === null ? '' : filters.minGain * 100}
            onChange={(e) => set({ minGain: e.target.value === '' ? null : Number(e.target.value) / 100 })}
          />
        </label>
        <fieldset className="field field--tests">
          <legend>Must pass</legend>
          {TESTS.map((t) => (
            <label key={t.key} className="check">
              <input type="checkbox" checked={filters.tests.includes(t.key)} onChange={() => toggleTest(t.key)} />
              {t.label}
            </label>
          ))}
        </fieldset>
        </div>}
      </div>

      <div className="card">
        <p className="muted">
          {visible.length} of {rows.length} stocks. Values use your multiples; missing data shows “–”, never zero.
          {loadMs !== null && <span> Loaded in {(loadMs / 1000).toFixed(2)}s.</span>}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th aria-label="Actions" />
                {shown.map((c) => (
                  <th
                    key={c.key}
                    className={`sortable ${c.align === 'right' ? 'num' : ''} ${dragging === c.key ? 'is-dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragging(c.key)}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragging) updatePrefs({ ...prefs, order: moveBefore(prefs.order, dragging, c.key) }); setDragging(null) }}
                    onClick={() => clickSort(c.key)}
                    title="Click to sort, drag to move"
                  >
                    {c.label}{arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.symbol}>
                  <td className="actions">
                    <Link className="icon-button" to={`/stock/${r.symbol}`} title={`Open ${r.symbol}`} aria-label={`Open ${r.symbol}`}>→</Link>
                    <button className="icon-button" onClick={() => setDetailsSymbol(r.symbol)} title={`Details for ${r.symbol}`} aria-label={`Details for ${r.symbol}`}>ⓘ</button>
                  </td>
                  {shown.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailsRow && <DetailsModal row={detailsRow} onClose={() => setDetailsSymbol(null)} />}
      {picking && <ColumnPicker prefs={prefs} onChange={updatePrefs} onClose={() => setPicking(false)} />}
    </div>
  )
}
