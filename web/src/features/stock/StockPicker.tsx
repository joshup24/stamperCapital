import type { StockOption } from '../../lib/stockOptions'
import StockCombobox from '../../components/StockCombobox'

interface Props {
  /** the stock shown now, or null when none is chosen yet */
  symbol: string | null
  options: StockOption[]
  onChange: (symbol: string) => void
  /** clears the selection (shows a ✕ in the box); leave out where there is nothing to clear */
  onClear?: () => void
}

/** Jump to any stock: type part of a symbol or name and pick from the list. The arrows step through the list. */
export default function StockPicker({ symbol, options, onChange, onClear }: Props) {
  const i = symbol ? options.findIndex((o) => o.symbol === symbol) : -1
  const step = (d: -1 | 1) => {
    const next = options[i + d]
    if (next) onChange(next.symbol)
  }

  return (
    <div className="picker-row">
      <button className="icon-button" onClick={() => step(-1)} disabled={i <= 0} aria-label="Previous stock" title="Previous stock">◀</button>
      <StockCombobox
        label="Stock"
        placeholder="Type a symbol or name"
        options={options}
        text={symbol ? (options.find((o) => o.symbol === symbol)?.label ?? symbol) : ''}
        onPick={onChange}
        onClear={onClear}
      />
      <button className="icon-button" onClick={() => step(1)} disabled={i < 0 || i >= options.length - 1} aria-label="Next stock" title="Next stock">▶</button>
    </div>
  )
}
