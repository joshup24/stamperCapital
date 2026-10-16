// Light / dark theme. Light is the default (the brand guidelines favor it for dense tables);
// a person's choice is remembered in this browser, otherwise their system setting is used.

export type Theme = 'light' | 'dark'
const KEY = 'stamper.theme'

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export function applyTheme(t: Theme, remember = false) {
  document.documentElement.setAttribute('data-theme', t)
  if (remember) {
    try { localStorage.setItem(KEY, t) } catch { /* storage unavailable: still works this visit */ }
  }
}

/** Call once at startup, before the first render. */
export function initTheme() {
  applyTheme(storedTheme() ?? systemTheme())
  document.documentElement.setAttribute('data-product', 'yield')
}
