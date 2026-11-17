import { useMemo } from 'react'
import type { FeltPoint, Mismatch, Moment } from '../../shared/session'
import { monotone, useWidth } from './chart'
import Timeline from './Timeline'
import { defaultCurve } from './util'

/**
 * Illustration only. Nothing here is measured. Everything that shows it is labelled "Example".
 * Felt trace: a decaying bump after each startle, the same shape idea the real report uses.
 */
const EX_TOTAL = 120
const EX_INTENDED = defaultCurve(EX_TOTAL)
const EX_MOMENTS: Moment[] = [
  { t: 31, kind: 'startle', strength: 0.35, durationSec: 1 },
  { t: 62, kind: 'startle', strength: 0.9, durationSec: 1 },
  { t: 64, kind: 'startle', strength: 0.4, durationSec: 1 }
]
const EX_FELT: FeltPoint[] = (() => {
  const out: FeltPoint[] = []
  for (let t = 0; t < EX_TOTAL; t++) {
    let v = 5 + 3 * Math.sin(t / 4)
    for (const m of EX_MOMENTS) {
      const dt = t - m.t
      if (dt >= 0 && dt < 5) v = Math.max(v, 70 * m.strength * (1 - dt / 5))
    }
    out.push({ t, level: Math.round(v * 10) / 10 })
  }
  return out
})()
const EX_MISMATCHES: Mismatch[] = [
  { start: 76, end: 92, kind: 'missed-peak', intended: 90, felt: 12, text: 'Example' }
]

/** A large example report line, used by the empty home screen. */
export function ExampleTimeline() {
  return (
    <Timeline
      variant="big"
      intended={EX_INTENDED}
      felt={EX_FELT}
      total={EX_TOTAL}
      moments={EX_MOMENTS}
      mismatches={EX_MISMATCHES}
      beats={[{ t: 62, label: 'Jump scare' }]}
      label="Example: a planned tension curve, a player's felt reaction, two flinches and one mismatch"
    />
  )
}

/** The first-run screen's one visual: a single faint tension line that draws itself. */
export function FaintLine() {
  const [ref, w] = useWidth<HTMLDivElement>()
  const h = 220
  const d = useMemo(() => {
    const pts = [
      { t: 0, level: 14 }, { t: 12, level: 22 }, { t: 28, level: 48 }, { t: 40, level: 40 },
      { t: 55, level: 78 }, { t: 66, level: 96 }, { t: 80, level: 52 }, { t: 100, level: 24 }
    ]
    const c = monotone(pts)
    return c.path((t) => (t / 100) * w, (v) => h - 24 - (v / 100) * (h - 56))
  }, [w])
  return (
    <div ref={ref} className="key-line" aria-hidden="true">
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <path d={d} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" pathLength={1} className="draw-felt" style={{ animationDuration: '2200ms' }} />
        </svg>
      )}
    </div>
  )
}
