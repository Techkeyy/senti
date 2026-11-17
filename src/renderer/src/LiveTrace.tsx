import { useEffect, useMemo, useRef, useState } from 'react'
import { useWidth } from './chart'

export interface TracePoint {
  /** Epoch ms when the reading arrived. */
  ts: number
  /** Reading, or null when there was none that second (no face, no data): drawn as a gap. */
  v: number | null
}

export function useReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = (): void => setR(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return r
}

interface Props {
  points: TracePoint[]
  windowSec: number
  /** True while readings are really arriving: the trace scrolls with the clock. False: it rests at the last reading. */
  live: boolean
  height?: number
  /** Top of the scale. Readings above it are clamped. */
  max?: number
  /** Optional dashed reference line, e.g. the flinch threshold. */
  threshold?: number
  thresholdLabel?: string
  label: string
}

/**
 * A scrolling monitor strip. The path is rebuilt only when a reading arrives; between readings it moves by
 * transform alone, so scrolling stays smooth. A missing reading breaks the line instead of being invented.
 */
export default function LiveTrace({ points, windowSec, live, height = 96, max = 3, threshold, thresholdLabel, label }: Props) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const reduced = useReducedMotion()
  const origin = useRef(Date.now())
  const gRef = useRef<SVGGElement>(null)
  const padR = 12
  const pxPerSec = w > 0 ? (w - padR) / windowSec : 0
  const y = (v: number): number => height - 6 - (Math.min(max, Math.max(0, v)) / max) * (height - 12)
  const xAt = (ts: number): number => ((ts - origin.current) / 1000) * pxPerSec

  const last = points.length ? points[points.length - 1].ts : origin.current

  const { d, dots } = useMemo(() => {
    const keep = points.filter((p) => p.ts >= last - (windowSec + 3) * 1000)
    let path = ''
    const lone: Array<[number, number]> = []
    let run: Array<[number, number]> = []
    const flush = (): void => {
      if (run.length === 1) lone.push(run[0])
      else if (run.length > 1) path += run.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ') + ' '
      run = []
    }
    let prevTs = -Infinity
    for (const p of keep) {
      if (p.v === null || p.ts - prevTs > 2600) flush()
      if (p.v !== null) run.push([xAt(p.ts), y(p.v)])
      prevTs = p.ts
    }
    flush()
    return { d: path.trim(), dots: lone }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, pxPerSec, height, max, windowSec])

  useEffect(() => {
    const g = gRef.current
    if (!g || w === 0) return
    const place = (now: number): void => {
      g.style.transform = `translateX(${(w - padR - xAt(now)).toFixed(1)}px)`
    }
    if (!live || reduced) {
      place(live ? Date.now() : last)
      return
    }
    let raf = 0
    const tick = (): void => {
      place(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, reduced, w, last, pxPerSec])

  return (
    <div ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label} style={{ display: 'block', overflow: 'hidden' }}>
          <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" />
          {threshold !== undefined && (
            <g>
              <line x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} stroke="var(--muted)" strokeDasharray="3 5" opacity={0.7} />
              {thresholdLabel && (
                <text x={4} y={y(threshold) - 6} className="axis-text" style={{ fontSize: 13 }}>
                  {thresholdLabel}
                </text>
              )}
            </g>
          )}
          <g ref={gRef}>
            {d && <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />}
            {dots.map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={2} fill="var(--text)" />
            ))}
          </g>
        </svg>
      )}
    </div>
  )
}
