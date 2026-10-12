import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { brand } from './brand/brand'
import { configured } from './lib/supabase'
import { AuthProvider, useAuth } from './features/auth/AuthProvider'
import LoginPage from './features/auth/LoginPage'
import ScreenerPage from './features/screener/ScreenerPage'
import MultiplesPage from './features/multiples/MultiplesPage'
import StockPage from './features/stock/StockPage'
import ChartPreview from './dev/ChartPreview'
import { DataProvider } from './features/screener/DataContext'

function Shell() {
  const { session, loading, signOut } = useAuth()

  if (!configured) {
    return <p className="message message--error">Supabase is not configured. Check web/.env (see .env.example).</p>
  }
  if (loading) return <p className="message">Loading…</p>
  if (!session) return <LoginPage />

  return (
    <DataProvider>
      <header className="app-header">
        {brand.logo && <img src={brand.logo} alt={brand.name} />}
        <Link to="/" className="app-header__name">{brand.name}</Link>
        <nav className="app-nav">
          <NavLink to="/" end>Screener</NavLink>
          <NavLink to="/multiples">Multiples</NavLink>
        </nav>
        <span className="app-header__spacer" />
        <span className="app-header__tagline">{session.user.email}</span>
        <button className="button button--ghost" onClick={signOut}>Sign out</button>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<ScreenerPage />} />
          <Route path="/multiples" element={<MultiplesPage />} />
          <Route path="/stock/:symbol" element={<StockPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </DataProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {import.meta.env.DEV && <Route path="/dev/charts" element={<ChartPreview />} />}
        <Route
          path="*"
          element={
            <AuthProvider>
              <Shell />
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
