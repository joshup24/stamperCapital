import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { brand } from '../../brand/brand'
import Logo from '../../components/Logo'
import ThemeToggle from '../../components/ThemeToggle'

// Sign-in only. Accounts are invite-only (public sign-ups are switched off in Supabase).
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="login__theme"><ThemeToggle /></div>
      <form className="card login__form" onSubmit={submit}>
        <Logo variant="stacked" width={240} className="login__logo" />
        <h1 className="sr-only">Sign in to {brand.name}</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <p className="message message--error">{error}</p>}
        <button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
