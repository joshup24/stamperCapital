import type { ReactNode } from 'react'
import type { ScreenerRow } from '../../lib/screener'
import { isAlert, type Num } from '../../lib/valuation'
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

/** An alert value; highlighted with a ▲ (never colour alone) when it is above zero. */
function alertCell(value: Num, onTitle: string, offTitle: string): ReactNode {
  return isAlert(value)
    ? <span className="flag" title={onTitle}>▲ {money(value, 1)}</span>
    : <span title={offTitle}>{money(value, 1)}</span>
}

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
  { key: 'multCust', label: 'Mult-Cust', align: 'right', value: (r) => r.valuation.breakEvenMultiple, defaultVisible: true,
    render: (r) => <span title="Net-income multiple at which value would equal the price">{money(r.valuation.breakEvenMultiple, 1)}</span> },
  { key: 'voiPrice', label: 'VoI − Price', align: 'right', value: (r) => r.valuation.voiMinusPrice, defaultVisible: true,
    render: (r) => <span className={signClass(r.valuation.voiMinusPrice)}>{money(r.valuation.voiMinusPrice)}</span> },
  { key: 'alert1', label: 'Alert 1', align: 'right', value: (r) => r.valuation.alert1, defaultVisible: true,
    render: (r) => alertCell(r.valuation.alert1, 'Assets value exceeds the price', 'Assets value minus price') },
  { key: 'alert2', label: 'Alert 2', align: 'right', value: (r) => r.valuation.alert2, defaultVisible: true,
    render: (r) => alertCell(r.valuation.alert2, 'Assets plus dividend value exceed the price', 'Assets plus dividend value, minus price') },
  { key: 'revenue', label: 'Revenue 000s', align: 'right', value: (r) => r.revenue000s, defaultVisible: false,
    render: (r) => money(r.revenue000s, 0) },
  { key: 'currency', label: 'Curr', align: 'left', value: (r) => r.currency, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.currency)}</span> },
  { key: 'marketCap', label: 'Market Cap 000s', align: 'right', value: (r) => r.marketCap000s, defaultVisible: false,
    render: (r) => money(r.marketCap000s, 0) },
  { key: 'priceDate', label: 'Price date', align: 'left', value: (r) => r.priceDate, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.priceDate)}</span> },
  { key: 'balanceDate', label: 'Balance sheet', align: 'left', value: (r) => r.balanceSheetDate, defaultVisible: false,
    render: (r) => <span className="muted">{text(r.balanceSheetDate)}</span> },
]

export const COLUMN_KEYS = COLUMNS.map((c) => c.key)
export const DEFAULT_HIDDEN = COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.key)
export const REQUIRED = COLUMNS.filter((c) => c.required).map((c) => c.key)
