import { useState } from 'react'
import { applyTheme, currentTheme, type Theme } from '../lib/theme'

/** Switches between light and dark and remembers the choice in this browser. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      className="button button--ghost"
      onClick={() => { applyTheme(next, true); setTheme(next) }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
