interface Props {
  /** what is being cleared, for screen readers ("Clear Group") */
  label: string
  onClear: () => void
  /** where it sits: inside a text box, just left of a dropdown's arrow, or inline after a heading */
  placement?: 'input' | 'select' | 'inline'
}

/** The ✕ that puts one control back to its default. It never steals focus from the control. */
export default function ClearButton({ label, onClear, placement = 'input' }: Props) {
  return (
    <button
      type="button"
      className={`clear-x clear-x--${placement}`}
      aria-label={`Clear ${label.toLowerCase()}`}
      title="Clear"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
    >
      ✕
    </button>
  )
}
