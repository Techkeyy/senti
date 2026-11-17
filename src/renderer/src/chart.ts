// Pure chart math shared by Timeline, CurveEditor and LiveTrace. No DOM.
import { useEffect, useRef, useState } from 'react'
import type { IntendedPoint } from '../../shared/session'

export interface Pt {
  t: number
  level: number
}

/**
 * Monotone cubic (Fritsch-Carlson). Passes through every point and never overshoots between neighbours,
 * so a peak stays at the height the designer drew.
 */
export function monotone(points: Pt[]): { path(x: (t: number) => number, y: (l: number) => number): string; at(t: number): number } {
  const p = [...points].sort((a, b) => a.t - b.t)
  const n = p.length
  const d: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].level - p[i].level) / Math.max(1e-9, p[i + 1].t - p[i].t))
  if (n > 1) {
    m[0] = d[0]
    m[n - 1] = d[n - 2]
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0
        m[i + 1] = 0
        continue
      }
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const k = 3 / Math.sqrt(s)
        m[i] = k * a * d[i]
        m[i + 1] = k * b * d[i]
      }
    }
  }
  return {
    path(x, y) {
      if (n === 0) return ''
      let s = `M${x(p[0].t).toFixed(2)},${y(p[0].level).toFixed(2)}`
      for (let i = 0; i < n - 1; i++) {
        const dt = p[i + 1].t - p[i].t
        const c1t = p[i].t + dt / 3
        const c1l = p[i].level + (m[i] * dt) / 3
        const c2t = p[i + 1].t - dt / 3
        const c2l = p[i + 1].level - (m[i + 1] * dt) / 3
        s += ` C${x(c1t).toFixed(2)},${y(c1l).toFixed(2)} ${x(c2t).toFixed(2)},${y(c2l).toFixed(2)} ${x(p[i + 1].t).toFixed(2)},${y(p[i + 1].level).toFixed(2)}`
      }
      return s
    },
    at(t) {
      if (n === 0) return 0
      if (t <= p[0].t) return p[0].level
      if (t >= p[n - 1].t) return p[n - 1].level
      let i = 0
      while (i < n - 2 && t > p[i + 1].t) i++
      const dt = p[i + 1].t - p[i].t
      const u = (t - p[i].t) / dt
      const u2 = u * u
      const u3 = u2 * u
      return (
        (2 * u3 - 3 * u2 + 1) * p[i].level +
        (u3 - 2 * u2 + u) * dt * m[i] +
        (-2 * u3 + 3 * u2) * p[i + 1].level +
        (u3 - u2) * dt * m[i + 1]
      )
    }
  }
}

export function linePath(pts: Pt[], x: (t: number) => number, y: (l: number) => number): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(p.level).toFixed(2)}`).join(' ')
}

export const toPts = (a: IntendedPoint[]): Pt[] => a.map((p) => ({ t: p.t, level: p.level }))

/** Strength words used in tooltips and the mismatch list. Same thresholds everywhere. */
export function strengthWord(s: number): string {
  return s >= 0.6 ? 'strong' : s >= 0.3 ? 'clear' : 'mild'
}

/** Pixel width of an element, kept current with ResizeObserver. 0 until measured. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.floor(el.getBoundingClientRect().width))
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface FlagSlot<B> {
  b: B
  idx: number
  row: number
  flip: boolean
}

/** Places beat flags on a few rows so neighbouring labels do not overlap; flips a flag left when it would run off the right edge. */
export function flagRows<B extends { t: number; label: string }>(beats: B[], x: (t: number) => number, maxX: number, rows = 2): FlagSlot<B>[] {
  const end: number[] = new Array(rows).fill(-1e9)
  const out: FlagSlot<B>[] = []
  beats
    .map((b, idx) => ({ b, idx }))
    .sort((p, q) => p.b.t - q.b.t)
    .forEach(({ b, idx }) => {
      const wText = b.label.length * 7.6 + 56
      const flip = x(b.t) + wText > maxX
      const left = flip ? x(b.t) - wText : x(b.t)
      let row = end.findIndex((e) => e < left)
      if (row < 0) row = 0
      end[row] = flip ? x(b.t) : x(b.t) + wText
      out.push({ b, idx, row, flip })
    })
  return out
}
