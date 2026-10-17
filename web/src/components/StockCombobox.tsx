import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { highlight, matchStocks } from '../lib/stockSearch'
import type { StockOption } from '../lib/stockOptions'
import ClearButton from './ClearButton'

interface Props {
  options: StockOption[]
  /** what the box shows when you are not typing */
  text: string
  /** called on every keystroke (the screener uses this to filter its table as you type) */
  onTextChange?: (text: string) => void
  /** called when a stock is chosen from the list */
  onPick: (symbol: string) => void
  /** when given, a ✕ appears while the box has text; it should clear the selection */
  onClear?: () => void
  placeholder?: string
  label: string
}

/**
 * Type to filter, then pick from the list. Matches the start of a symbol or name word (and, from
 * 3 letters, text inside them), best matches first, with the matched letters in bold. Mouse, or
 * keyboard: arrows to move, Enter to pick, Esc to close. Used on the stock page and the screener
 * so they behave the same.
 */
export default function StockCombobox({ options, text, onTextChange, onPick, onClear, placeholder, label }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null) // what you have typed since focusing; null = nothing yet
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const matches = useMemo(() => matchStocks(options, draft ?? ''), [options, draft])
  const activeId = open && matches[active] ? `${id}-opt-${active}` : undefined
  const shown = draft ?? text

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  function pick(o: StockOption) {
    setDraft(null)
    setOpen(false)
    onPick(o.symbol)
  }

  function clear() {
    setDraft(null)
    onClear?.()
    setActive(0)
    setOpen(true)
    inputRef.current?.focus() // ready to type the next one
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && matches[active]) { e.preventDefault(); pick(matches[active]) }
    } else if (e.key === 'Escape') {
      setDraft(null)
      setOpen(false)
    }
  }

  return (
    <div className="combo">
      <label className="field">
        <span>{label}</span>
        <span className="combo__box">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            value={shown}
            placeholder={placeholder}
            onFocus={(e) => { e.currentTarget.select(); setOpen(true); setActive(0) }}
            onBlur={() => { setOpen(false); setDraft(null) }}
            onChange={(e) => { setDraft(e.target.value); onTextChange?.(e.target.value); setOpen(true); setActive(0) }}
            onKeyDown={onKeyDown}
          />
          {onClear && shown !== '' && <ClearButton label={label} onClear={clear} />}
        </span>
      </label>
      {open && (
        <ul id={listId} role="listbox" className="combo__list" aria-label={`${label} matches`}>
          {matches.length === 0 && <li className="combo__empty" role="presentation">No stock matches “{draft}”.</li>}
          {matches.map((o, i) => (
            <li
              key={o.symbol}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combo__option ${i === active ? 'combo__option--active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }} // before the input loses focus
              onMouseEnter={() => setActive(i)}
            >
              {highlight(o.label, draft ?? '').map((p, k) => (p.hit ? <mark key={k} className="combo__hit">{p.text}</mark> : <span key={k}>{p.text}</span>))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
