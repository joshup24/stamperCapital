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
