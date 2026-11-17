import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Beat, IntendedPoint } from '../../shared/session'
import { flagRows, monotone, toPts, useWidth } from './chart'
import { fmt, tickStep } from './util'

const H = 360
const M = { l: 40, r: 24, t: 60, b: 32 }

interface Props {
  plannedSec: number
  points: IntendedPoint[]
  beats: Beat[]
  onChange: (p: IntendedPoint[]) => void
  onBeatsChange: (b: Beat[]) => void
}

type Drag = { kind: 'point'; i: number } | { kind: 'beat'; i: number } | null

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/**
 * The curve is the hero. Click empty space to add a point, drag to move, right-click or Delete to remove.
 * Keyboard: Tab to a handle, arrows move it (Shift for bigger steps), Delete removes it. Ends keep their time.
 * Beats are flags above the plot: drag sideways, or select one and press Delete.
 */
export default function CurveEditor({ plannedSec, points, beats, onChange, onBeatsChange }: Props) {
  const [wrapRef, W] = useWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [selBeat, setSelBeat] = useState<number | null>(null)
  const [focusPt, setFocusPt] = useState<number | null>(null)
  const [dragging, setDragging] = useState<Drag>(null)
  const drag = useRef<Drag>(null)

  const pw = Math.max(1, W - M.l - M.r)
  const ph = H - M.t - M.b
  const x = (t: number): number => M.l + (t / plannedSec) * pw
  const y = (level: number): number => M.t + ph - (level / 100) * ph

  function toData(e: { clientX: number; clientY: number }): { t: number; level: number } {
    const r = svgRef.current!.getBoundingClientRect()
    const t = Math.round(((e.clientX - r.left - M.l) / pw) * plannedSec)
    const level = Math.round(((M.t + ph - (e.clientY - r.top)) / ph) * 100)
    return { t: clamp(t, 0, plannedSec), level: clamp(level, 0, 100) }
  }

  function setPoint(i: number, t: number, level: number): void {
    const next = points.map((p) => ({ ...p }))
    const last = points.length - 1
    if (i !== 0 && i !== last) next[i].t = clamp(t, points[i - 1].t + 1, points[i + 1].t - 1)
    next[i].level = clamp(level, 0, 100)
    onChange(next)
  }

  function setBeatT(i: number, t: number): void {
    onBeatsChange(beats.map((b, k) => (k === i ? { ...b, t: clamp(t, 0, plannedSec) } : b)))
  }

  function begin(d: Drag, e: React.PointerEvent): void {
    drag.current = d
    setDragging(d)
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function onBackgroundDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    const { t, level } = toData(e)
    setSelBeat(null)
    const existing = points.findIndex((p) => p.t === t)
    if (existing >= 0) {
      setSel(existing)
      begin({ kind: 'point', i: existing }, e)
      return
    }
    const next = [...points, { t, level }].sort((a, b) => a.t - b.t)
    const idx = next.findIndex((p) => p.t === t)
    onChange(next)
    setSel(idx)
    begin({ kind: 'point', i: idx }, e)
  }

  function onPointDown(e: React.PointerEvent, i: number): void {
    e.stopPropagation()
    if (e.button !== 0) return
    setSel(i)
    setSelBeat(null)
    begin({ kind: 'point', i }, e)
  }

  function onBeatDown(e: React.PointerEvent, i: number): void {
    e.stopPropagation()
    if (e.button !== 0) return
    setSelBeat(i)
    setSel(null)
    begin({ kind: 'beat', i }, e)
  }

  function onMove(e: React.PointerEvent): void {
    const d = drag.current
    if (!d) return
    const { t, level } = toData(e)
    if (d.kind === 'point') setPoint(d.i, t, level)
    else setBeatT(d.i, t)
  }

  function onUp(): void {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (d?.kind === 'beat') {
      // Keep beats in time order once the drag ends.
      const moved = beats[d.i]
      const sorted = [...beats].sort((a, b) => a.t - b.t)
      if (sorted.some((b, k) => b !== beats[k])) {
        onBeatsChange(sorted)
        setSelBeat(sorted.indexOf(moved))
      }
    }
  }

  function removePoint(i: number): void {
    if (i === 0 || i === points.length - 1) return
    onChange(points.filter((_, k) => k !== i))
    setSel(null)
    setFocusPt(null)
    requestAnimationFrame(() => svgRef.current?.querySelector<SVGElement>(`[data-handle="${i - 1}"]`)?.focus())
  }

  function removeBeat(i: number): void {
    onBeatsChange(beats.filter((_, k) => k !== i))
    setSelBeat(null)
  }

  function onPointKey(e: React.KeyboardEvent, i: number): void {
    const big = e.shiftKey ? 5 : 1
    const p = points[i]
    if (e.key === 'ArrowLeft') setPoint(i, p.t - big, p.level)
    else if (e.key === 'ArrowRight') setPoint(i, p.t + big, p.level)
    else if (e.key === 'ArrowUp') setPoint(i, p.t, p.level + big)
    else if (e.key === 'ArrowDown') setPoint(i, p.t, p.level - big)
    else if (e.key === 'Delete' || e.key === 'Backspace') removePoint(i)
    else return
    e.preventDefault()
  }

  function onBeatKey(e: React.KeyboardEvent, i: number): void {
    const big = e.shiftKey ? 5 : 1
    if (e.key === 'ArrowLeft') setBeatT(i, beats[i].t - big)
    else if (e.key === 'ArrowRight') setBeatT(i, beats[i].t + big)
    else if (e.key === 'Delete' || e.key === 'Backspace') removeBeat(i)
    else return
    e.preventDefault()
  }

  const step = (() => {
    let s = tickStep(plannedSec)
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    while (pw / (plannedSec / s) < 64 && steps.indexOf(s) >= 0 && steps.indexOf(s) < steps.length - 1) s = steps[steps.indexOf(s) + 1]
    return s
  })()
  const ticks: number[] = []
  for (let t = 0; t <= plannedSec; t += step) ticks.push(t)

  const curve = monotone(toPts(points))
  const d = W > 0 ? curve.path(x, y) : ''
  const area = d ? `${d} L${x(points[points.length - 1].t)},${y(0)} L${x(points[0].t)},${y(0)} Z` : ''
  const flags = flagRows(beats, x, W - M.r)

  // Live readout: while dragging, and while a handle has keyboard focus.
  const activePt = dragging?.kind === 'point' ? dragging.i : focusPt
  const activeBeat = dragging?.kind === 'beat' ? dragging.i : null
  let readout: { left: number; top: number; node: React.ReactNode } | null = null
  if (activePt !== null && points[activePt]) {
    const p = points[activePt]
    readout = {
      left: clamp(x(p.t), 80, W - 80),
      top: y(p.level) - 14,
      node: (
        <>
          Tension <b>{p.level}</b> at <b>{fmt(p.t)}</b>
        </>
      )
    }
  } else if (activeBeat !== null && beats[activeBeat]) {
    const b = beats[activeBeat]
    readout = {
      left: clamp(x(b.t), 80, W - 80),
      top: M.t - 8,
      node: (
        <>
          {b.label} at <b>{fmt(b.t)}</b>
        </>
      )
    }
  }

  return (
    <div className="editor-wrap" ref={wrapRef} style={{ height: H + 12 }}>
      {W > 0 && (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label="Intended tension curve editor. Tab to a point, use the arrow keys to move it, Delete to remove it."
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{ cursor: 'crosshair' }}
        >
          {[0, 25, 50, 75, 100].map((l) => (
            <g key={l}>
              <line x1={M.l} x2={W - M.r} y1={y(l)} y2={y(l)} stroke="var(--line)" strokeWidth={1} />
              {(l === 0 || l === 50 || l === 100) && (
                <text x={M.l - 10} y={y(l) + 4} textAnchor="end" className="axis-text">
                  {l}
                </text>
              )}
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + ph} stroke="var(--line)" strokeWidth={1} />
              <text x={x(t)} y={H - 8} textAnchor={t === 0 ? 'start' : 'middle'} className="axis-text">
                {fmt(t)}
              </text>
            </g>
          ))}

          {/* Beat flags */}
          {flags.map(({ b, idx, row, flip }) => {
            const bx = x(b.t)
            const ty = 22 + row * 22
            const on = selBeat === idx || dragging?.kind === 'beat'
            const label = `${b.label} at ${fmt(b.t)}`
            return (
              <g
                key={idx}
                className="beat"
                tabIndex={0}
                role="slider"
                aria-label={`Beat ${b.label}`}
                aria-valuemin={0}
                aria-valuemax={plannedSec}
                aria-valuenow={b.t}
                aria-valuetext={label}
                onFocus={() => setSelBeat(idx)}
                onKeyDown={(e) => onBeatKey(e, idx)}
                onPointerDown={(e) => onBeatDown(e, idx)}
                style={{ cursor: 'ew-resize' }}
              >
                <line x1={bx} x2={bx} y1={ty + 4} y2={M.t + ph} stroke="var(--text)" opacity={on ? 0.45 : 0.22} strokeWidth={1} />
                <line x1={bx} x2={bx} y1={ty - 12} y2={ty + 4} stroke="var(--text)" strokeWidth={1.5} />
                <rect x={flip ? bx - 8 - (b.label.length * 7.6 + 56) : bx - 8} y={ty - 16} width={b.label.length * 7.6 + 64} height={24} fill="transparent" />
                <text x={bx + (flip ? -7 : 7)} y={ty} textAnchor={flip ? 'end' : 'start'} className="flag-text">
                  {b.label}
                  <tspan className="flag-time" dx={6}>
                    {fmt(b.t)}
                  </tspan>
                </text>
              </g>
            )
          })}
          {selBeat !== null && beats[selBeat] && (
            <g
              role="button"
              aria-label={`Remove beat ${beats[selBeat].label}`}
              tabIndex={-1}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => {
                e.stopPropagation()
                removeBeat(selBeat)
              }}
              transform={`translate(${x(beats[selBeat].t) - 8}, ${M.t + ph - 22})`}
            >
              <rect width={16} height={16} rx={4} fill="var(--raised)" stroke="var(--line-strong)" />
              <X x={3} y={3} size={10} strokeWidth={2} color="var(--text2)" />
            </g>
          )}

          {area && <path d={area} fill="var(--text)" opacity={0.04} pointerEvents="none" />}
          {d && <path d={d} fill="none" stroke="var(--text)" strokeWidth={2.25} strokeDasharray="8 6" strokeLinecap="round" pointerEvents="none" />}

          {points.map((p, i) => {
            const on = sel === i || activePt === i
            return (
              <g
                key={i}
                data-handle={i}
                className="handle"
                tabIndex={0}
                role="slider"
                aria-label={`Tension point ${i + 1}`}
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.level}
                aria-valuetext={`Tension ${p.level} at ${fmt(p.t)}`}
                onFocus={() => {
                  setSel(i)
                  setFocusPt(i)
                }}
                onBlur={() => setFocusPt(null)}
                onKeyDown={(e) => onPointKey(e, i)}
                onPointerDown={(e) => onPointDown(e, i)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  removePoint(i)
                }}
              >
                <circle cx={x(p.t)} cy={y(p.level)} r={16} fill="transparent" />
                <circle className="focus-ring" cx={x(p.t)} cy={y(p.level)} r={11} fill="none" stroke="var(--text)" strokeWidth={2} />
                <circle className="handle-ring" cx={x(p.t)} cy={y(p.level)} r={on ? 7 : 5.5} fill={on ? 'var(--text)' : 'var(--bg)'} stroke="var(--text)" strokeWidth={1.75} />
              </g>
            )
          })}
        </svg>
      )}
      {readout && (
        <div className="readout" style={{ left: readout.left, top: readout.top }} aria-hidden="true">
          {readout.node}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {activePt !== null && points[activePt] ? `Tension ${points[activePt].level} at ${fmt(points[activePt].t)}` : ''}
      </div>
    </div>
  )
}
