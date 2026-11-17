// Pure helper for the camera reader's rebuild loop (used by sensing-worker.ts, unit tested).
export const REBUILD_MAX = 6
export const REBUILD_WINDOW_MS = 120_000

/** Records a rebuild at `now`. `ok` is false when more than `max` rebuilds happened within `windowMs`. */
export function noteRebuild(times: number[], now: number, max = REBUILD_MAX, windowMs = REBUILD_WINDOW_MS): { ok: boolean; times: number[] } {
  const kept = times.filter((t) => now - t < windowMs)
  kept.push(now)
  return { ok: kept.length <= max, times: kept }
}
