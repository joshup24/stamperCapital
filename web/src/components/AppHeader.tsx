import { Link, NavLink } from 'react-router-dom'
import { brand } from '../brand/brand'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'

interface Props {
  email: string
  onSignOut: () => void
}

/** Top bar: product symbol and name at the left, navigation, then account controls (guidelines p.29). */
export default function AppHeader({ email, onSignOut }: Props) {
  return (
    <header className="app-header">
      <Link to="/" className="app-brand" aria-label={`${brand.name} home`}>
        <Logo variant="symbol" width={40} />
        <span className="app-brand__name">{brand.name}</span>
      </Link>
      <nav className="app-nav" aria-label="Main">
        <NavLink to="/" end>Screener</NavLink>
        <NavLink to="/stock">Stock</NavLink>
        <NavLink to="/multiples">Multiples</NavLink>
        <NavLink to="/import">Import</NavLink>
      </nav>
      <span className="app-header__spacer" />
      <span className="app-header__tagline">{email}</span>
      <ThemeToggle />
      <button className="button button--ghost" onClick={onSignOut}>Sign out</button>
    </header>
  )
}
