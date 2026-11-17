import type { IntendedPoint } from '../../shared/session'

export interface Shape {
  id: string
  label: string
  /** [fraction of the planned length, level 0..100] */
  pts: Array<[number, number]>
}

export const SHAPES: Shape[] = [
  {
    id: 'slow-burn',
    label: 'Slow burn',
    pts: [[0, 8], [0.2, 14], [0.45, 30], [0.7, 52], [0.9, 82], [1, 60]]
  },
  {
    id: 'jump-scare',
    label: 'Jump scare',
    pts: [[0, 12], [0.35, 16], [0.56, 22], [0.6, 96], [0.68, 40], [0.8, 22], [1, 14]]
  },
  {
    id: 'boss-fight',
    label: 'Boss fight',
    pts: [[0, 20], [0.15, 40], [0.3, 70], [0.45, 55], [0.6, 85], [0.75, 65], [0.9, 98], [1, 30]]
  }
]

/** Turns a shape into points for a given length: whole seconds, strictly increasing, first at 0, last at the end. */
export function shapePoints(shape: Shape, plannedSec: number): IntendedPoint[] {
  const out: IntendedPoint[] = []
  const last = shape.pts.length - 1
  shape.pts.forEach(([f, level], i) => {
    let t = i === last ? plannedSec : Math.round(f * plannedSec)
    const prev = out[out.length - 1]
    if (prev && t <= prev.t) t = prev.t + 1
    if (i !== last && t >= plannedSec) return
    out.push({ t, level })
  })
  return out
}
