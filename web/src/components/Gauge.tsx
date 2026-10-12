import type { Num } from '../lib/valuation'

interface Props {
  /** The value to show, as a fraction (0.25 = +25%). */
  value: Num
  /** Range the dial covers. Values outside are pinned to the ends. */
  min?: number
  max?: number
  label: string
  display: string
}

const R = 70
const CX = 90
const CY = 90

const point = (angle: number, r: number) => ({
  x: CX + r * Math.cos(Math.PI - angle),
  y: CY - r * Math.sin(Math.PI - angle),
})

/** Half-circle dial: red on the left, green on the right, a needle for the value. */
export default function Gauge({ value, min = -0.5, max = 1, label, display }: Props) {
  const clamped = value === null ? null : Math.min(max, Math.max(min, value))
  const angle = clamped === null ? null : ((clamped - min) / (max - min)) * Math.PI
  const zero = ((0 - min) / (max - min)) * Math.PI

  const arc = (from: number, to: number) => {
    const a = point(from, R)
    const b = point(to, R)
    return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`
  }
  const tip = angle === null ? null : point(angle, R - 8)

  return (
    <figure className="gauge" aria-label={`${label}: ${display}`}>
      <svg viewBox="0 0 180 105" role="img">
        <path d={arc(0, zero)} className="gauge__arc gauge__arc--negative" />
        <path d={arc(zero, Math.PI)} className="gauge__arc gauge__arc--positive" />
        {tip && <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} className="gauge__needle" />}
        <circle cx={CX} cy={CY} r="5" className="gauge__hub" />
      </svg>
      <figcaption>
        <strong className="gauge__value">{display}</strong>
        <span className="muted">{label}</span>
      </figcaption>
    </figure>
  )
}
