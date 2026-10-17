import ClearButton from './ClearButton'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  label: string
  value: string
  /** the value that means "not filtered"; a ✕ appears whenever the selection differs from it */
  defaultValue: string
  options: SelectOption[]
  onChange: (value: string) => void
  inline?: boolean
}

/** A labelled dropdown that shows a ✕ while it is set to anything other than its default. */
export default function FilterSelect({ label, value, defaultValue, options, onChange, inline = false }: Props) {
  return (
    <label className={`field ${inline ? 'field--inline' : ''}`}>
      <span>{label}</span>
      <span className="clearable">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {value !== defaultValue && <ClearButton label={label} placement="select" onClear={() => onChange(defaultValue)} />}
      </span>
    </label>
  )
}
