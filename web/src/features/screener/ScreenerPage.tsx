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
import BulkBar from './BulkBar'
import StockCombobox from '../../components/StockCombobox'
import FilterSelect from '../../components/FilterSelect'
import ClearButton from '../../components/ClearButton'
import { stockOptions } from '../../lib/stockOptions'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  const visibleSymbols = visible.map((r) => r.symbol)
  const allSelected = visibleSymbols.length > 0 && visibleSymbols.every((s) => selected.has(s))
  const toggleOne = (sym: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(sym)) n.delete(sym); else n.add(sym); return n })
  const toggleAll = () => setSelected((cur) => { const n = new Set(cur); for (const s of visibleSymbols) { if (allSelected) n.delete(s); else n.add(s) } return n })

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
    filters.symbol && `Stock ${filters.symbol}`,
    filters.group && `Group ${filters.group}`,
    filters.category && `Category ${filters.category}`,
    filters.sector,
    filters.industry,
    basis === 'ttm' && 'Trailing four quarters',
    filters.minGain !== null && `Gain ≥ ${filters.minGain * 100}%`,
    ...filters.tests.map((t) => TESTS.find((x) => x.key === t)?.label),
  ].filter(Boolean) as string[]

  const groups = Object.keys(data.settings.groups).sort()
  const searchOptions = stockOptions(rows.map((r) => ({ symbol: r.symbol, name: r.name })), null)
  const categories = uniqueSorted(rows.map((r) => r.category))
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
        <StockCombobox
          label="Stock"
          placeholder="Type a symbol or name"
          options={searchOptions}
          text={filters.symbol ?? filters.search}
          onTextChange={(v) => set({ search: v, symbol: null })}
          onPick={(symbol) => set({ symbol, search: '' })}
          onClear={() => set({ symbol: null, search: '' })}
        />
        <FilterSelect
          label="Group" value={filters.group ?? ''} defaultValue=""
          options={[{ value: '', label: 'All' }, ...groups.map((g) => ({ value: g, label: g }))]}
          onChange={(v) => set({ group: v || null })}
        />
        <FilterSelect
          label="Category" value={filters.category ?? ''} defaultValue=""
          options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: c }))]}
          onChange={(v) => set({ category: v || null })}
        />
        <FilterSelect
          label="Sector" value={filters.sector ?? ''} defaultValue=""
          options={[{ value: '', label: 'All' }, ...sectors.map((x) => ({ value: x, label: x }))]}
          onChange={(v) => set({ sector: v || null, industry: null })}
        />
        <FilterSelect
          label="Industry" value={filters.industry ?? ''} defaultValue=""
          options={[{ value: '', label: 'All' }, ...industries.map((x) => ({ value: x, label: x }))]}
          onChange={(v) => set({ industry: v || null })}
        />
        <FilterSelect
          label="Income basis" value={basis} defaultValue="fy"
          options={[{ value: 'fy', label: 'Last full year' }, { value: 'ttm', label: 'Trailing four quarters' }]}
          onChange={(v) => setBasis(v as Basis)}
        />
        <label className="field">
          <span>Min possible gain %</span>
          <span className="clearable">
            <input
              type="number" step="5" value={filters.minGain === null ? '' : filters.minGain * 100}
              onChange={(e) => set({ minGain: e.target.value === '' ? null : Number(e.target.value) / 100 })}
            />
            {filters.minGain !== null && <ClearButton label="Min possible gain" onClear={() => set({ minGain: null })} />}
          </span>
        </label>
        <fieldset className="field field--tests">
          <legend>Must pass{filters.tests.length > 0 && <ClearButton label="Must pass" placement="inline" onClear={() => set({ tests: [] })} />}</legend>
          {TESTS.map((t) => (
            <label key={t.key} className="check">
              <input type="checkbox" checked={filters.tests.includes(t.key)} onChange={() => toggleTest(t.key)} />
              {t.label}
            </label>
          ))}
        </fieldset>
        </div>}
      </div>

      {selected.size > 0 && (
        <BulkBar
          symbols={[...selected]} categories={categories} groups={groups}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="card">
        <p className="muted">
          {visible.length} of {rows.length} stocks. Values use your multiples; missing data shows “–”, never zero.
          {loadMs !== null && <span> Loaded in {(loadMs / 1000).toFixed(2)}s.</span>}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="select-col">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown stocks" />
                </th>
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
                <tr key={r.symbol} className={selected.has(r.symbol) ? 'row-selected' : ''}>
                  <td className="select-col">
                    <input type="checkbox" checked={selected.has(r.symbol)} onChange={() => toggleOne(r.symbol)} aria-label={`Select ${r.symbol}`} />
                  </td>
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
