import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isDrawableCandle, type PriceBar } from '../../lib/prices'
import { money } from '../../lib/format'

interface Candle {
  label: string
  open: number
  high: number
  low: number
  close: number
  /** [low, high]: gives the axis its range and the wick its length */
  range: [number, number]
}

const axisText = { fill: 'var(--color-text-muted)', fontSize: 12 }

interface ShapeProps {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: Candle
}

/** Draws one candle: a thin wick from low to high and a body from open to close. */
function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: ShapeProps) {
  if (!payload) return null
  const { open, close, high, low } = payload
  const span = high - low
  const px = (v: number) => (span === 0 ? y : y + ((high - v) / span) * height)
  const up = close >= open
  const color = up ? 'var(--color-positive)' : 'var(--color-negative)'
  const cx = x + width / 2
  const top = px(Math.max(open, close))
  const bottom = px(Math.min(open, close))
  const bodyW = Math.max(width * 0.7, 1)
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(bottom - top, 1)} fill={color} />
    </g>
  )
}

function CandleTooltip({ active, payload }: { active?: boolean; payload?: { payload: Candle }[] }) {
  if (!active || !payload?.length) return null
  const c = payload[0].payload
  return (
    <div className="chart-tooltip">
      <strong>{c.label}</strong>
      <div>Open {money(c.open)}</div>
      <div>High {money(c.high)}</div>
      <div>Low {money(c.low)}</div>
      <div>Close {money(c.close)}</div>
    </div>
  )
}

/** Candlestick chart. Bars with missing or inconsistent prices are skipped, never drawn as zero. */
export default function CandleChart({ bars, height = 380 }: { bars: PriceBar[]; height?: number }) {
  const data: Candle[] = bars.filter(isDrawableCandle).map((b) => ({
    label: b.month.slice(0, 7),
    open: b.open!, high: b.high!, low: b.low!, close: b.close!,
    range: [b.low!, b.high!],
  }))
  if (data.length === 0) return <p className="muted">No price bars to chart.</p>

  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={axisText} stroke="var(--chart-grid)" minTickGap={40} />
          <YAxis tick={axisText} stroke="var(--chart-grid)" width={60} domain={['auto', 'auto']} tickFormatter={(v: number) => money(v, 0)} />
          <Tooltip content={<CandleTooltip />} />
          <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
