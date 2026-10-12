import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export type Point = { label: string } & Record<string, string | number | null>

export interface Series {
  key: string
  label: string
  kind: 'bar' | 'line'
  /** which --chart-N brand color (1-6) */
  color: number
  /** bars sharing a stackId stack on top of each other */
  stackId?: string
  dashed?: boolean
}

interface Props {
  data: Point[]
  series: Series[]
  /** formats a value for the axis and tooltip */
  format: (n: number) => string
  /** fix the axis to 0-100% (for stacked ratios) */
  fixedPercent?: boolean
  height?: number
}

const colorOf = (n: number) => `var(--chart-${n})`
const axisText = { fill: 'var(--color-text-muted)', fontSize: 12 }

/** One chart for most tabs: bars and/or lines over time. All colors come from the brand tokens. */
export default function TimeChart({ data, series, format, fixedPercent = false, height = 340 }: Props) {
  if (data.length === 0) return <p className="muted">No data to chart.</p>

  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" tick={axisText} stroke="var(--chart-grid)" minTickGap={16} />
          <YAxis
            tick={axisText} stroke="var(--chart-grid)" width={70}
            tickFormatter={(v: number) => format(v)}
            domain={fixedPercent ? [0, 1] : ['auto', 'auto']}
          />
          <ReferenceLine y={0} stroke="var(--color-text-muted)" />
          <Tooltip
            formatter={(v, name) => [typeof v === 'number' ? format(v) : '–', name]}
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text)' }}
          />
          <Legend wrapperStyle={{ color: 'var(--color-text-muted)' }} />
          {series.map((s) =>
            s.kind === 'bar' ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s.color)} stackId={s.stackId} isAnimationActive={false} />
            ) : (
              <Line
                key={s.key} dataKey={s.key} name={s.label} stroke={colorOf(s.color)} strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined} dot={false} connectNulls={false} isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
