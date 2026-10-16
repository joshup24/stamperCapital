// Writes the user's own settings. Row level security keeps each person to their own rows;
// user_id is passed so "upsert" can find an existing row to replace.
import { supabase } from '../../lib/supabase'
import type { RuleKind } from '../../lib/multipleInput'

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function saveMultiple(userId: string, kind: RuleKind, name: string, multiple: number) {
  const { error } = await supabase
    .from('user_multiple')
    .upsert({ user_id: userId, kind, name, multiple }, { onConflict: 'user_id,kind,name' })
  check(error)
}

export async function deleteMultiple(kind: RuleKind, name: string) {
  const { error } = await supabase.from('user_multiple').delete().eq('kind', kind).eq('name', name)
  check(error)
}

export async function saveDefaultMultiple(userId: string, multiple: number) {
  const { error } = await supabase
    .from('user_setting')
    .upsert({ user_id: userId, default_multiple: multiple, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  check(error)
}

/** Sets the user's own category for a stock; null removes it. */
export async function saveCategory(userId: string, symbol: string, category: string | null) {
  if (category === null) {
    const { error } = await supabase.from('user_ticker_category').delete().eq('symbol', symbol)
    check(error)
    return
  }
  const { error } = await supabase
    .from('user_ticker_category')
    .upsert({ user_id: userId, symbol, category }, { onConflict: 'user_id,symbol' })
  check(error)
}

// ---- Bulk tagging (screener selection and CSV import) -------------------------------------

const CHUNK = 500
const chunks = <T,>(xs: T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

/** Sets (or, with null, removes) the user's category on many stocks at once. */
export async function saveCategories(userId: string, symbols: string[], category: string | null) {
  for (const part of chunks(symbols)) {
    if (category === null) {
      const { error } = await supabase.from('user_ticker_category').delete().in('symbol', part)
      check(error)
    } else {
      const { error } = await supabase
        .from('user_ticker_category')
        .upsert(part.map((symbol) => ({ user_id: userId, symbol, category })), { onConflict: 'user_id,symbol' })
      check(error)
    }
  }
}

/** Adds stocks to one of the user's groups (already-members are left alone). */
export async function addToGroup(userId: string, group: string, symbols: string[]) {
  for (const part of chunks(symbols)) {
    const { error } = await supabase
      .from('user_group')
      .upsert(part.map((symbol) => ({ user_id: userId, group_name: group, symbol })), {
        onConflict: 'user_id,group_name,symbol', ignoreDuplicates: true,
      })
    check(error)
  }
}

export async function removeFromGroup(group: string, symbols: string[]) {
  for (const part of chunks(symbols)) {
    const { error } = await supabase.from('user_group').delete().eq('group_name', group).in('symbol', part)
    check(error)
  }
}

/** Saves parsed CSV rows: a category per stock (the last one given wins) and group memberships. */
export async function applyImport(
  userId: string,
  rows: { symbol: string; category: string | null; group: string | null }[],
): Promise<{ categories: number; memberships: number }> {
  const cat = new Map<string, string>()
  const groups = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.category) cat.set(r.symbol, r.category)
    if (r.group) (groups.get(r.group) ?? groups.set(r.group, new Set()).get(r.group)!).add(r.symbol)
  }
  const byCategory = new Map<string, string[]>()
  for (const [symbol, c] of cat) (byCategory.get(c) ?? byCategory.set(c, []).get(c)!).push(symbol)

  for (const [c, symbols] of byCategory) await saveCategories(userId, symbols, c)
  let memberships = 0
  for (const [g, symbols] of groups) { await addToGroup(userId, g, [...symbols]); memberships += symbols.size }
  return { categories: cat.size, memberships }
}
