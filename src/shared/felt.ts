// OWNER: sensing builder. Pure, deterministic felt-curve model. Unit tested with Vitest.
import type { ComputeReport } from './session'

export const computeReport: ComputeReport = () => ({
  felt: [],
  moments: [],
  mismatches: [],
  baseline: { headSpeedP95: 0, talkingMean: 0, seconds: 0 }
})
