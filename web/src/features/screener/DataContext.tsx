import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadScreenerData, loadSettings, type ScreenerData } from './load'

interface DataState {
  data: ScreenerData | null
  error: string | null
  loadMs: number | null
  /** Re-reads only the user's settings (after saving a multiple, category...). */
  refreshSettings: () => Promise<void>
}

const Ctx = createContext<DataState>({ data: null, error: null, loadMs: null, refreshSettings: async () => {} })

/** Loads the screener data once for the whole signed-in app. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ScreenerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadMs, setLoadMs] = useState<number | null>(null)

  useEffect(() => {
    const t0 = performance.now()
    loadScreenerData()
      .then((d) => { setData(d); setLoadMs(performance.now() - t0) })
      .catch((e: Error) => setError(e.message))
  }, [])

  const refreshSettings = useCallback(async () => {
    const settings = await loadSettings()
    setData((d) => (d ? { ...d, settings } : d))
  }, [])

  return <Ctx.Provider value={{ data, error, loadMs, refreshSettings }}>{children}</Ctx.Provider>
}

export const useData = () => useContext(Ctx)
