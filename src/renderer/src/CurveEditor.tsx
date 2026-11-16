import { useRef, useState } from 'react'
import type { Beat, IntendedPoint } from '../../shared/session'
import { fmt, tickStep } from './util'

const W = 900
const H = 280
const M = { l: 44, r: 16, t: 24, b: 30 }
const PW = W - M.l - M.r
const PH = H - M.t - M.b

interface Props {
  plannedSec: number
  points: IntendedPoint[]
  beats: Beat[]
  onChange: (p: IntendedPoint[]) => void
}

/** Click to add, drag to move, right-click or Delete to remove. Ends stay at 0 and the planned length. */
export default function CurveEditor({ plannedSec, points, beats, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const dragging = useRef<number | null>(null)

  const x = (t: number): number => M.l + (t / plannedSec) * PW
  const y = (level: number): number => M.t + PH - (level / 100) * PH

  function toData(e: { clientX: number; clientY: number }): { t: number; level: number } {
    const r = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    const t = Math.round(((px - M.l) / PW) * plannedSec)
    const level = Math.round(((M.t + PH - py) / PH) * 100)
    return { t: Math.min(plannedSec, Math.max(0, t)), level: Math.min(100, Math.max(0, level)) }
  }

  function movePoint(i: number, t: number, level: number): void {
    const next = points.map((p) => ({ ...p }))
    const last = points.length - 1
    if (i !== 0 && i !== last) next[i].t = Math.min(points[i + 1].t - 1, Math.max(points[i - 1].t + 1, t))
    next[i].level = level
    onChange(next)
  }

  function onBackgroundDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    svgRef.current?.focus()
    const { t, level } = toData(e)
    const existing = points.findIndex((p) => p.t === t)
    if (existing >= 0) {
      setSel(existing)
      dragging.current = existing
    } else {
      const next = [...points, { t, level }].sort((a, b) => a.t - b.t)
      const idx = next.findIndex((p) => p.t === t)
      onChange(next)
      setSel(idx)
      dragging.current = idx
    }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointDown(e: React.PointerEvent, i: number): void {
    e.stopPropagation()
    if (e.button !== 0) return
    svgRef.current?.focus()
    setSel(i)
    dragging.current = i
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function onMove(e: React.PointerEvent): void {
    if (dragging.current === null) return
    const { t, level } = toData(e)
    movePoint(dragging.current, t, level)
  }

  function remove(i: number): void {
    if (i === 0 || i === points.length - 1) return
    onChange(points.filter((_, k) => k !== i))
    setSel(null)
  }

  const step = tickStep(plannedSec)
  const ticks: number[] = []
  for (let t = 0; t <= plannedSec; t += step) ticks.push(t)
  if (plannedSec - ticks[ticks.length - 1] > step / 2) ticks.push(plannedSec)

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.level)}`).join(' ')

  return (
    <div>
      <svg
        ref={svgRef}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        tabIndex={0}
        role="img"
        aria-label="Intended tension curve editor"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = null)}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) remove(sel)
        }}
        style={{ cursor: 'crosshair', touchAction: 'none' }}
      >
        {[0, 25, 50, 75, 100].map((l) => (
          <g key={l}>
            <line x1={M.l} x2={W - M.r} y1={y(l)} y2={y(l)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.l - 8} y={y(l) + 4} textAnchor="end">
              {l}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.t} y2={M.t + PH} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
            <text x={x(t)} y={H - 8} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {beats.map((b, i) => (
          <g key={i}>
            <line x1={x(b.t)} x2={x(b.t)} y1={M.t} y2={M.t + PH} stroke="var(--warn)" strokeDasharray="4 4" strokeWidth={1.5} />
            <text x={x(b.t) + 4} y={M.t + 12} style={{ fill: 'var(--warn)' }}>
              {b.label}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(p.t)}
            cy={y(p.level)}
            r={sel === i ? 9 : 7}
            fill={sel === i ? 'var(--accent)' : 'var(--bg)'}
            stroke="var(--accent)"
            strokeWidth={3}
            style={{ cursor: 'grab' }}
            onPointerDown={(e) => onPointDown(e, i)}
            onContextMenu={(e) => {
              e.preventDefault()
              remove(i)
            }}
          />
        ))}
      </svg>
      <p className="dim" style={{ fontSize: 'var(--fs-label)', marginTop: 8 }}>
        Click to add a point, drag to move it, right-click or press Delete to remove it. Height is how tense this moment
        should feel, from 0 (calm) to 100 (peak).
        {sel !== null && points[sel] ? ` Selected: ${fmt(points[sel].t)} at level ${points[sel].level}.` : ''}
      </p>
    </div>
  )
}
