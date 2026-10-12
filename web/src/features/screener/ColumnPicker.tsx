import Modal from '../../components/Modal'
import { shiftColumn, type ColumnPrefs } from '../../lib/columnPrefs'
import { COLUMNS, DEFAULT_HIDDEN, COLUMN_KEYS, REQUIRED } from './columns'

interface Props {
  prefs: ColumnPrefs
  onChange: (p: ColumnPrefs) => void
  onClose: () => void
}

export default function ColumnPicker({ prefs, onChange, onClose }: Props) {
  const byKey = Object.fromEntries(COLUMNS.map((c) => [c.key, c]))

  const toggle = (key: string) =>
    onChange({
      ...prefs,
      hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key],
    })

  return (
    <Modal title="Columns" onClose={onClose}>
      <p className="muted">Tick to show. Use the arrows to reorder (you can also drag the table headers).</p>
      <ul className="picker">
        {prefs.order.map((key, i) => (
          <li key={key}>
            <label className="check">
              <input
                type="checkbox"
                checked={!prefs.hidden.includes(key)}
                disabled={REQUIRED.includes(key)}
                onChange={() => toggle(key)}
              />
              {byKey[key].label}
            </label>
            <span>
              <button className="button button--ghost" disabled={i === 0} aria-label={`Move ${byKey[key].label} earlier`}
                onClick={() => onChange({ ...prefs, order: shiftColumn(prefs.order, key, -1) })}>▲</button>
              <button className="button button--ghost" disabled={i === prefs.order.length - 1} aria-label={`Move ${byKey[key].label} later`}
                onClick={() => onChange({ ...prefs, order: shiftColumn(prefs.order, key, 1) })}>▼</button>
            </span>
          </li>
        ))}
      </ul>
      <p>
        <button className="button button--ghost" onClick={() => onChange({ order: COLUMN_KEYS, hidden: DEFAULT_HIDDEN })}>
          Reset to default
        </button>
      </p>
    </Modal>
  )
}
