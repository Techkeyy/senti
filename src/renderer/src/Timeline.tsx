import { memo, useMemo, useState } from 'react'
import type { Beat, FeltPoint, IntendedPoint, Marker, Mismatch, Moment } from '../../shared/session'
import { FlinchMark } from './FlinchMark'
import { flagRows, monotone, linePath, strengthWord, toPts, useWidth } from './chart'
import { fmt, tickStep } from './util'

export interface TimelineData {
  intended: IntendedPoint[]
  felt: FeltPoint[]
  total: number
  beats?: Beat[]
  markers?: Marker[]
  moments?: Moment[]
  mismatches?: Mismatch[]
}

interface Layout {
  w: number
  h: number
  ml: number
  mr: number
  mt: number
  lane: number
  mb: number
  big: boolean
  flags: boolean
}

function layoutFor(variant: 'big' | 'mini' | 'live', w: number): Layout {
  if (variant === 'big') return { w, h: 328, ml: 40, mr: 16, mt: 52, lane: 36, mb: 28, big: true, flags: true }
  if (variant === 'live') return { w, h: 196, ml: 32, mr: 8, mt: 20, lane: 32, mb: 24, big: true, flags: false }
  return { w, h: 64, ml: 4, mr: 4, mt: 6, lane: 16, mb: 2, big: false, flags: false }
}

const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

interface LayersProps extends TimelineData {
  l: Layout
  draw: boolean
}

/** Everything that does not change while the playhead or the hover moves. */
const Layers = memo(function Layers({ l, draw, intended, felt, total, beats = [], markers = [], moments = [], mismatches = [] }: LayersProps) {
  const pw = l.w - l.ml - l.mr
  const ph = l.h - l.mt - l.mb - l.lane
  const x = (t: number): number => l.ml + (Math.min(total, Math.max(0, t)) / total) * pw
  const y = (v: number): number => l.mt + ph + 0 - (Math.min(100, Math.max(0, v)) / 100) * ph
  const laneBase = l.mt + ph + l.lane - (l.big ? 8 : 2)
  const curve = useMemo(() => monotone(toPts(intended)), [intended])
  const intendedPath = curve.path(x, y)
  const feltPath = linePath(felt, x, y)

  // Mismatch washes between the two curves.
  const washes = mismatches.map((m) => {
    const a = Math.max(0, Math.floor(m.start))
    const b = Math.min(total, Math.ceil(m.end))
    const up: string[] = []
    const down: string[] = []
    for (let t = a; t <= b; t++) {
      up.push(`${x(t).toFixed(2)},${y(curve.at(t)).toFixed(2)}`)
      down.push(`${x(t).toFixed(2)},${y(felt[t]?.level ?? 0).toFixed(2)}`)
    }
    return `M${up.join(' L')} L${down.reverse().join(' L')} Z`
  })

  let step = tickStep(total)
  while (pw / (total / step) < 64 && STEPS.indexOf(step) >= 0 && STEPS.indexOf(step) < STEPS.length - 1) step = STEPS[STEPS.indexOf(step) + 1]
  const ticks: number[] = []
  if (l.big) for (let t = 0; t <= total; t += step) ticks.push(t)

  const flags = l.flags ? flagRows(beats, x, l.w - l.mr) : []

  const startles = moments.filter((m) => m.kind === 'startle')
  const voices = l.big ? moments.filter((m) => m.kind === 'voice') : []
  const looks = l.big ? moments.filter((m) => m.kind === 'lookaway') : []

  return (
    <g>
      {l.big &&
        [0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={l.ml} x2={l.w - l.mr} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            {(v === 0 || v === 50 || v === 100) && (
              <text x={l.ml - 8} y={y(v) + 4} textAnchor="end" className="axis-text">
                {v}
              </text>
            )}
          </g>
        ))}
      {!l.big && <line x1={l.ml} x2={l.w - l.mr} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />}
      {l.big &&
        ticks.map((t) => (
          <text key={t} x={x(t)} y={l.h - 6} textAnchor={t === 0 ? 'start' : x(t) > l.w - l.mr - 22 ? 'end' : 'middle'} className="axis-text">
            {fmt(t)}
          </text>
        ))}

      {looks.map((m, i) => (
        <rect key={`lk${i}`} x={x(m.t)} y={l.mt} width={Math.max(2, x(m.t + m.durationSec) - x(m.t))} height={ph + l.lane} fill="var(--text)" opacity={0.07} />
      ))}

      {washes.map((d, i) => (
        <path key={`w${i}`} d={d} fill="var(--ember)" opacity={0.16} className={draw ? 'fade-in late' : undefined} />
      ))}

      {flags.map(({ b, row, flip }, i) => {
        const bx = x(b.t)
        const ty = 18 + row * 20
        return (
          <g key={`f${i}`}>
            <line x1={bx} x2={bx} y1={ty + 4} y2={l.mt + ph} stroke="var(--text)" opacity={0.22} strokeWidth={1} />
            <line x1={bx} x2={bx} y1={ty - 11} y2={ty + 4} stroke="var(--text)" strokeWidth={1.5} />
            <text x={bx + (flip ? -7 : 7)} y={ty} textAnchor={flip ? 'end' : 'start'} className="flag-text">
              {b.label}
              <tspan className="flag-time" dx={6}>
                {fmt(b.t)}
              </tspan>
            </text>
          </g>
        )
      })}

      {markers.map((m, i) => (
        <line key={`m${i}`} x1={x(m.t)} x2={x(m.t)} y1={l.mt} y2={l.mt + 9} stroke="var(--text2)" strokeWidth={2} strokeLinecap="round" />
      ))}

      <path d={intendedPath} fill="none" stroke="var(--text)" strokeWidth={l.big ? 2 : 1.5} strokeDasharray={l.big ? '7 6' : '4 4'} opacity={l.big ? 0.8 : 0.6} />
      {felt.length > 0 && (
        <path
          d={feltPath}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={l.big ? 2.5 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className={draw ? 'draw-felt' : undefined}
        />
      )}

      {voices.map((m, i) => (
        <circle key={`v${i}`} cx={x(m.t)} cy={laneBase - 4} r={l.big ? 4 : 2.5} fill="none" stroke="var(--text2)" strokeWidth={1.5} />
      ))}
      <g className={draw ? 'fade-in late' : undefined}>
        {startles.map((m, i) => (
          <FlinchMark key={`s${i}`} x={x(m.t)} base={laneBase} h={(l.big ? 10 : 5) + (l.big ? 14 : 7) * m.strength} r={l.big ? 3 : 2.2} />
        ))}
      </g>
    </g>
  )
})

interface Props extends TimelineData {
  variant: 'big' | 'mini' | 'live'
  /** Draw the felt line on first appearance. */
  draw?: boolean
  now?: number
  onSeek?: (t: number) => void
  label?: string
}

export default function Timeline({ variant, draw = true, now, onSeek, label, ...data }: Props) {
  const big = variant !== 'mini'
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const l = layoutFor(variant, Math.max(0, w))
  const pw = l.w - l.ml - l.mr
  const total = Math.max(1, data.total)
  const x = (t: number): number => l.ml + (Math.min(total, Math.max(0, t)) / total) * pw
  const ph = l.h - l.mt - l.mb - l.lane
  const laneBase = l.mt + ph + l.lane - 8

  function timeAt(e: React.PointerEvent | React.MouseEvent): number {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(total, Math.max(0, ((e.clientX - r.left - l.ml) / pw) * total))
  }

  const startles = (data.moments ?? []).filter((m) => m.kind === 'startle')
  const voices = (data.moments ?? []).filter((m) => m.kind === 'voice')

  return (
    <div ref={ref} className={`timeline ${variant}`} style={{ height: l.h, position: 'relative' }}>
      {w > 0 && (
        <svg
          width={l.w}
          height={l.h}
          viewBox={`0 0 ${l.w} ${l.h}`}
          role="img"
          aria-label={label ?? 'Intended tension as a dashed line, felt reaction as a solid line, flinches as spikes'}
          style={{ display: 'block', cursor: onSeek ? 'pointer' : undefined }}
          onClick={onSeek ? (e) => onSeek(timeAt(e)) : undefined}
          onPointerMove={big ? (e) => setHoverT(timeAt(e)) : undefined}
          onPointerLeave={big ? () => (setHoverT(null), setTip(null)) : undefined}
        >
          <Layers l={l} draw={draw} {...data} total={total} />
          {big && hoverT !== null && (
            <line x1={x(hoverT)} x2={x(hoverT)} y1={l.mt} y2={l.mt + ph + l.lane} stroke="var(--text)" opacity={0.25} strokeWidth={1} pointerEvents="none" />
          )}
          {big &&
            startles.map((m, i) => (
              <rect
                key={`hs${i}`}
                x={x(m.t) - 9}
                y={laneBase - 30}
                width={18}
                height={36}
                fill="transparent"
                onPointerEnter={() => setTip({ x: x(m.t), y: laneBase - 14 - 14 * m.strength, text: `Flinch at ${fmt(m.t)}, ${strengthWord(m.strength)}` })}
                onPointerLeave={() => setTip(null)}
              />
            ))}
          {big &&
            voices.map((m, i) => (
              <rect
                key={`hv${i}`}
                x={x(m.t) - 9}
                y={laneBase - 16}
                width={18}
                height={24}
                fill="transparent"
                onPointerEnter={() => setTip({ x: x(m.t), y: laneBase - 14, text: `Voice reaction at ${fmt(m.t)}` })}
                onPointerLeave={() => setTip(null)}
              />
            ))}
          {now !== undefined && (
            <g pointerEvents="none">
              <line x1={x(now)} x2={x(now)} y1={l.mt - 6} y2={l.mt + ph + l.lane} stroke="var(--text)" strokeWidth={1.5} />
              <path d={`M${x(now) - 5},${l.mt - 12} L${x(now) + 5},${l.mt - 12} L${x(now)},${l.mt - 5} Z`} fill="var(--text)" />
            </g>
          )}
        </svg>
      )}
      {big && hoverT !== null && !tip && (
        <div className="tip tip-time mono" style={{ left: x(hoverT), top: l.mt + ph + l.lane + 2 }}>
          {fmt(hoverT)}
        </div>
      )}
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}
