export const IPC = {
  windowMinimize: 'window:minimize',
  windowRestore: 'window:restore',
  windowSetBusy: 'window:set-busy',
  // Product API (contract owned by the director; see src/shared/session.ts)
  keyStatus: 'key:status',
  keySet: 'key:set',
  keyClear: 'key:clear',
  sensingStart: 'sensing:start',
  sensingPhase: 'sensing:phase',
  sensingStop: 'sensing:stop',
  sensingEvent: 'sensing:event', // main -> renderer push, SensingEvent
  sensingPreview: 'sensing:preview', // main -> renderer push, PreviewFrame (phase 'check' only)
  sessionsList: 'sessions:list',
  sessionsGet: 'sessions:get',
  sessionsSave: 'sessions:save',
  sessionsDelete: 'sessions:delete',
  hotkeysEnable: 'hotkeys:enable',
  hotkey: 'hotkey' // main -> renderer push, 'marker' | 'stop'
} as const

/** Summary row for the session list. */
export interface SessionSummary {
  id: string
  name: string
  createdAt: string
  playedSec: number
  hasRecording: boolean
}

export interface SentiApi {
  /** Minimizes the Senti window so the game can be in front while recording. */
  windowMinimize(): Promise<void>
  /** Restores and focuses the Senti window. */
  windowRestore(): Promise<void>
  /** Tells main a playtest is running or being saved, so closing the window asks first. */
  setBusy(busy: boolean): Promise<void>
  // Product API
  keyStatus(): Promise<{ hasKey: boolean }>
  keySet(key: string): Promise<{ hasKey: boolean }>
  keyClear(): Promise<{ hasKey: boolean }>
  /** Opens the camera in main and starts the SDK. Resolves once started (state may still be 'starting'). */
  sensingStart(): Promise<void>
  /** check = send preview frames + validation; baseline/play = record SecondSamples with t relative to playStartedAtMs. */
  sensingPhase(phase: SensingPhase, playStartedAtMs?: number): Promise<void>
  /** Stops the SDK and releases the camera. Returns everything recorded since sensingStart. */
  sensingStop(): Promise<{ baseline: SecondSample[]; samples: SecondSample[]; restarts: number; signals: string[] }>
  onSensingEvent(cb: (e: SensingEvent) => void): () => void
  onPreview(cb: (f: PreviewFrame) => void): () => void
  sessionsList(): Promise<SessionSummary[]>
  sessionsGet(id: string): Promise<Session | null>
  /** Saves session.json and the gameplay recording into userData/sessions/<id>/. */
  sessionsSave(session: Session, recording: ArrayBuffer | null): Promise<void>
  sessionsDelete(id: string): Promise<void>
  /** URL the renderer can put in a <video src> for a session's recording (custom protocol). */
  sessionVideoUrl(id: string): string
  /** Global hotkeys during play: F8 = marker, F9 = stop. */
  hotkeysEnable(on: boolean): Promise<void>
  onHotkey(cb: (k: 'marker' | 'stop') => void): () => void
}

import type { PreviewFrame, SecondSample, SensingEvent, SensingPhase, Session } from './session'
