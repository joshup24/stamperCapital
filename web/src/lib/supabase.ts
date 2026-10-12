import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configured = Boolean(url && key)

// Publishable key only. The secret key must never be used in the browser.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')
