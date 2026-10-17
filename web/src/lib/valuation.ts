// Joshua's valuation method, in one place. Pure functions: no UI, no network.
//
//   value/share = multiple x net income/share
//               + multiple x dividends/share
//               + value of assets/share
//
// Rule everywhere in this file: missing data stays missing (null). Nothing is
// quietly turned into 0, because that hides problems. The only inputs allowed to
// default to 0 are dividends (a company that pays none), as in the database views.

export type Num = number | null

export interface ValuationInputs {
  /** User's multiple for this stock (already resolved: ticker, category, industry, sector, default). */
  multiple: number
  /** Value of assets per share, as computed by the database (can be negative). */
  assetsPerShare: Num
  netIncomePerShare: Num
  /**
   * Net income from continuing operations per share. When given, income value uses the LOWER of
   * the two, as the Power BI report did; when missing, plain net income is used.
   */
  netIncomeContPerShare?: Num
  /** Reference only in the model, but the screener can test it. */
  ebitdaPerShare: Num
  /** Null is treated as 0: no dividend paid. */
  dividendsPerShare: Num
  price: Num
}

export interface ValuationResult {
  assetsValue: Num
  incomeValue: Num
  dividendValue: Num
  ebitdaValue: Num
  /** assets + income + dividends: the intrinsic value per share. */
  intrinsic: Num
  /** Same as intrinsic but with EBITDA replacing net income. */
  intrinsicOnEbitda: Num
  /** intrinsic / price - 1. 0.25 means 25% above the price. */
  possibleGain: Num
  possibleGainOnEbitda: Num
  /** Income value minus price ("VoI - Price" in the Equity Summary). */
  voiMinusPrice: Num
  /** Assets value minus price. Above zero means the balance sheet alone covers the price. */
  alert1: Num
  /** Assets value plus dividend value, minus price. Above zero is the highlighted case. */
  alert2: Num
  /**
   * "Mult-Cust": the net-income multiple at which value would equal the price, holding assets and
   * dividend value fixed: (price - assets - dividend value) / net income per share. Blank when net
   * income is not positive. Negative when assets plus dividends already exceed the price.
   * Uses plain net income, as the Power BI measure did.
   */
  breakEvenMultiple: Num
}

function times(a: number, b: Num): Num {
  return b === null ? null : a * b
}

function plus(...parts: Num[]): Num {
  let total = 0
  for (const p of parts) {
    if (p === null) return null
    total += p
  }
  return total
}

/** Gain of value over price. Null if either is missing or the price is not positive. */
export function gainOverPrice(value: Num, price: Num): Num {
  if (value === null || price === null || price <= 0) return null
  return value / price - 1
}

export function valuate(inputs: ValuationInputs): ValuationResult {
  const { multiple, assetsPerShare, netIncomePerShare, netIncomeContPerShare, ebitdaPerShare, price } = inputs
  const dividends = inputs.dividendsPerShare ?? 0

  // Income value uses the lower of net income and continuing-operations income. If net income itself
  // is missing the value is missing (never guessed from the other figure); if only the continuing
  // figure is missing, net income is used.
  const incomeBasis =
    netIncomePerShare === null || netIncomeContPerShare == null
      ? netIncomePerShare
      : Math.min(netIncomePerShare, netIncomeContPerShare)

  const assetsValue = assetsPerShare
  const incomeValue = times(multiple, incomeBasis)
  const dividendValue = multiple * dividends
  const ebitdaValue = times(multiple, ebitdaPerShare)

  const intrinsic = plus(assetsValue, incomeValue, dividendValue)
  const intrinsicOnEbitda = plus(assetsValue, ebitdaValue, dividendValue)

  const hasPrice = price !== null && price !== undefined
  return {
    assetsValue,
    incomeValue,
    dividendValue,
    ebitdaValue,
    intrinsic,
    intrinsicOnEbitda,
    possibleGain: gainOverPrice(intrinsic, price),
    possibleGainOnEbitda: gainOverPrice(intrinsicOnEbitda, price),
    voiMinusPrice: hasPrice && incomeValue !== null ? incomeValue - price : null,
    alert1: hasPrice && assetsValue !== null ? assetsValue - price : null,
    alert2: hasPrice && assetsValue !== null ? assetsValue + dividendValue - price : null,
    breakEvenMultiple:
      hasPrice && assetsValue !== null && netIncomePerShare !== null && netIncomePerShare > 0
        ? (price - assetsValue - dividendValue) / netIncomePerShare
        : null,
  }
}

// ---------------------------------------------------------------------------
// Which multiple applies. Precedence (same as the database view ticker_multiple):
// ticker, then category, then industry, then sector, then the default.
// ---------------------------------------------------------------------------

export type MultipleSource = 'ticker' | 'category' | 'industry' | 'sector' | 'default'

export interface MultipleChoice {
  multiple: number
  source: MultipleSource
}

export interface MultipleLookup {
  ticker?: number | null
  category?: number | null
  industry?: number | null
  sector?: number | null
  fallback: number
}

export function resolveMultiple(m: MultipleLookup): MultipleChoice {
  if (m.ticker != null) return { multiple: m.ticker, source: 'ticker' }
  if (m.category != null) return { multiple: m.category, source: 'category' }
  if (m.industry != null) return { multiple: m.industry, source: 'industry' }
  if (m.sector != null) return { multiple: m.sector, source: 'sector' }
  return { multiple: m.fallback, source: 'default' }
}

/**
 * Alert 1 and Alert 2 are highlighted when they are above zero: the balance sheet (Alert 1), or the
 * balance sheet plus dividend value (Alert 2), already covers the price. Missing is never an alert.
 */
export function isAlert(value: Num): boolean {
  return value !== null && value > 0
}
