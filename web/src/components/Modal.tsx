import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

/** A popup built on the browser's own <dialog>: Esc closes it, focus is handled for us. */
export default function Modal({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}  // click on the backdrop
    >
      <div className="modal__head">
        <h2>{title}</h2>
        <button className="button button--ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="modal__body">{children}</div>
    </dialog>
  )
}
