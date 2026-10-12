import type { ReactNode } from 'react'
import type { ScreenerRow } from '../../lib/screener'
import type { Num } from '../../lib/valuation'
import { money, percent, signClass } from '../../lib/format'

// One definition per table column. Adding a column to the screener = adding an entry here;
// sorting, the column picker, reordering and remembered preferences all pick it up.
export interface Column {
  key: string
  label: string
  align: 'left' | 'right'
  /** What the column sorts on. */
  value: (r: ScreenerRow) => Num | string
  render: (r: ScreenerRow) => ReactNode
  /** Shown by default? */
  defaultVisible: boolean
  /** Cannot be hidden. */
  required?: boolean
}

const text = (v: string | null) => v ?? '–'

export const COLUMNS: Column[] = [
  { key: 'symbol', label: 'Symbol', align: 'left', value: (r) => r.symbol, defaultVisible: true, required: true,
    render: (r) => (
      <>
        <strong>{r.symbol}</strong>
        {r.anyOverridden && <span className="badge" title="Includes your corrections">C</span>}
        {r.fxMissing && <span className="badge badge--warn" title="Currency rate missing">FX</span>}
      </>
    ) },
  { key: 'industry', label: 'Industry', align: 'left', value: (r) => r.industry, defaultVisible: true,
    render: (r) => <span className="muted">{text(r.industry)}</span> },
  { key: 'sector', label: 'Sector', align: 'left', value: (r) => r.sector, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.sector)}</span> },
  { key: 'category', label: 'Category', align: 'left', value: (r) => r.category, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.category)}</span> },
  { key: 'price', label: 'Price', align: 'right', value: (r) => r.price, defaultVisible: true,
    render: (r) => money(r.price) },
  { key: 'multiple', label: 'Multiple', align: 'right', value: (r) => r.multiple, defaultVisible: true,
    render: (r) => (
      <span title={`from ${r.multipleSource}`}>
        {r.multiple}{r.multipleSource !== 'default' && <span className="muted"> {r.multipleSource[0]}</span>}
      </span>
    ) },
  { key: 'assets', label: 'Assets / share', align: 'right', value: (r) => r.valuation.assetsValue, defaultVisible: true,
    render: (r) => money(r.valuation.assetsValue) },
  { key: 'income', label: 'Income value', align: 'right', value: (r) => r.valuation.incomeValue, defaultVisible: true,
    render: (r) => money(r.valuation.incomeValue) },
  { key: 'dividend', label: 'Dividend value', align: 'right', value: (r) => r.valuation.dividendValue, defaultVisible: false,
    render: (r) => money(r.valuation.dividendValue) },
  { key: 'ebitda', label: 'EBITDA value', align: 'right', value: (r) => r.valuation.ebitdaValue, defaultVisible: true,
    render: (r) => money(r.valuation.ebitdaValue) },
  { key: 'value', label: 'Value / share', align: 'right', value: (r) => r.valuation.intrinsic, defaultVisible: true,
    render: (r) => money(r.valuation.intrinsic) },
  { key: 'gain', label: 'Possible gain', align: 'right', value: (r) => r.valuation.possibleGain, defaultVisible: true,
    render: (r) => <span className={`strong ${signClass(r.valuation.possibleGain)}`}>{percent(r.valuation.possibleGain)}</span> },
  { key: 'priceDate', label: 'Price date', align: 'left', value: (r) => r.priceDate, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.priceDate)}</span> },
  { key: 'balanceDate', label: 'Balance sheet', align: 'left', value: (r) => r.balanceSheetDate, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.balanceSheetDate)}</span> },
]

export const COLUMN_KEYS = COLUMNS.map((c) => c.key)
export const DEFAULT_HIDDEN = COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.key)
export const REQUIRED = COLUMNS.filter((c) => c.required).map((c) => c.key)
