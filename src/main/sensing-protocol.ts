// Messages between the main-side sensing controller and the utilityProcess worker.
import type { PreviewFrame, SecondSample, SensingEvent, SensingPhase } from '../shared/session'

export interface SensingResult {
  baseline: SecondSample[]
  samples: SecondSample[]
  restarts: number
  signals: string[]
}

export type ToWorker =
  | { type: 'start'; apiKey: string }
  | { type: 'phase'; phase: SensingPhase; playStartedAtMs?: number }
  | { type: 'stop' }
  | { type: 'packageCheck' }

export type FromWorker =
  | { type: 'event'; event: SensingEvent }
  | { type: 'preview'; frame: PreviewFrame }
  | { type: 'stopped'; result: SensingResult }
  | { type: 'packageCheck'; info: Record<string, unknown> }
