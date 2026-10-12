import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './brand/index.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
