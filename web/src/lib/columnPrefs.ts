// Which table columns are shown and in what order. Pure helpers, so they can be tested;
// where the choice is stored (the browser) is the caller's business.

export interface ColumnPrefs {
  order: string[]
  hidden: string[]
}

/**
 * Makes saved preferences safe to use against the current column list: unknown columns are
 * dropped, new columns are added at the end (hidden unless they are default-visible), and
 * the required column can never be hidden. Bad or missing input gives the defaults.
 */
export function reconcilePrefs(
  saved: unknown,
  all: string[],
  defaultHidden: string[],
  required: string[] = [],
): ColumnPrefs {
  const s = (saved ?? {}) as Partial<ColumnPrefs>
  const savedOrder = Array.isArray(s.order) ? s.order.filter((k): k is string => typeof k === 'string') : []
  const savedHidden = Array.isArray(s.hidden) ? s.hidden.filter((k): k is string => typeof k === 'string') : null

  const known = savedOrder.filter((k, i) => all.includes(k) && savedOrder.indexOf(k) === i)
  const added = all.filter((k) => !known.includes(k))
  const order = [...known, ...added]

  const hidden =
    savedHidden === null
      ? [...defaultHidden]
      : [...savedHidden.filter((k) => all.includes(k)), ...added.filter((k) => defaultHidden.includes(k))]

  return { order, hidden: [...new Set(hidden)].filter((k) => !required.includes(k)) }
}

/** Moves `key` to the position currently held by `target` (drag and drop). */
export function moveBefore(order: string[], key: string, target: string): string[] {
  if (key === target || !order.includes(key) || !order.includes(target)) return order
  const without = order.filter((k) => k !== key)
  without.splice(without.indexOf(target), 0, key)
  return without
}

/** Moves `key` one step earlier (-1) or later (+1). */
export function shiftColumn(order: string[], key: string, delta: -1 | 1): string[] {
  const i = order.indexOf(key)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
