import type { IntendedPoint } from '../../shared/session'

/** Seconds to m:ss. */
export function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Parse "2:10" or "130" to seconds; null if invalid. */
export function parseTime(text: string): number | null {
  const t = text.trim()
  const m = /^(\d+):([0-5]?\d)$/.exec(t)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  if (/^\d+$/.test(t)) return Number(t)
  return null
}

export function newSessionId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rnd}`
}

/** Intended level at time t (linear interpolation, clamped at the ends). */
export function levelAt(points: IntendedPoint[], t: number): number {
  if (points.length === 0) return 0
  if (t <= points[0].t) return points[0].level
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.t) return b.t === a.t ? b.level : a.level + ((b.level - a.level) * (t - a.t)) / (b.t - a.t)
  }
  return points[points.length - 1].level
}

/** Calm start, rise, peak, fall. */
export function defaultCurve(plannedSec: number): IntendedPoint[] {
  const shape: Array<[number, number]> = [
    [0, 10],
    [0.2, 25],
    [0.45, 60],
    [0.6, 90],
    [0.8, 50],
    [1, 15]
  ]
  return shape.map(([f, level]) => ({ t: Math.round(f * plannedSec), level }))
}

/** Rescale a curve to a new length, dropping points that collapse onto one second. */
export function rescaleCurve(points: IntendedPoint[], from: number, to: number): IntendedPoint[] {
  const out: IntendedPoint[] = []
  for (const p of points) {
    const t = Math.round((p.t * to) / from)
    if (out.length && out[out.length - 1].t === t) {
      if (p.t === from) out[out.length - 1] = { t, level: p.level }
      continue
    }
    out.push({ t, level: p.level })
  }
  return out
}

/** Nice tick spacing (seconds) so an axis has about 6 to 10 ticks. */
export function tickStep(total: number): number {
  for (const s of [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]) if (total / s <= 10) return s
  return 3600
}

/**
 * MediaRecorder webm files carry no duration, so <video> reports Infinity and seeking is flaky.
 * Seeking far past the end makes Chromium scan the file and learn the real duration.
 */
export function primeDuration(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration)) return resolve()
    const done = (): void => {
      video.removeEventListener('durationchange', onChange)
      resolve()
    }
    const onChange = (): void => {
      if (Number.isFinite(video.duration)) {
        video.currentTime = 0
        done()
      }
    }
    video.addEventListener('durationchange', onChange)
    video.currentTime = 1e7
    setTimeout(done, 4000)
  })
}
