// Dev-only synthetic readings. Reached only through "#dev-baseline", "#dev-play", "#dev-camera" hashes, so the
// screenshot walk can show these screens without opening the camera. Never used in a normal run.
import type { SecondSample, SensingStatus } from '../../shared/session'

export interface DevSim {
  /** Camera check: report the SDK as ready. */
  ready?: boolean
}

const SPIKES: Record<number, number> = { 38: 1.7, 95: 2.7, 96: 1.2, 118: 1.5 }

/** Deterministic fake second of readings: calm head motion, a few spikes, a short look away at 60 to 62. */
export function synthSample(t: number): SecondSample {
  const away = t >= 60 && t <= 62
  const calm = 0.12 + 0.1 * Math.abs(Math.sin(t * 1.7))
  return {
    t,
    face: !away,
    headSpeedMax: away ? null : (SPIKES[t] ?? calm),
    headSpeedMedian: away ? null : calm / 2,
    talking: 0,
    fear: null,
    surprise: null,
    neutral: null,
    samples: 14
  }
}

export function devStatus(sim: DevSim): SensingStatus {
  return sim.ready
    ? { state: 'running', hint: '', ready: true, restarts: 0 }
    : { state: 'running', hint: 'Increase light on face.', ready: false, restarts: 0 }
}
