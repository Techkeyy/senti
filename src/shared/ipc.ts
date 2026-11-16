export const IPC = {
  listSources: 'recorder:list-sources',
  selectSource: 'recorder:select-source',
  saveRecording: 'recorder:save-recording',
  spikeConfig: 'spike:config',
  spikeResult: 'spike:result'
} as const

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

export interface SaveRecordingResult {
  path: string
  bytes: number
}

export interface SentiApi {
  listSources(): Promise<CaptureSource[]>
  selectSource(id: string): Promise<void>
  saveRecording(data: ArrayBuffer): Promise<SaveRecordingResult>
  spikeConfig(): Promise<{ autotest: boolean }>
  spikeResult(result: unknown): Promise<void>
}
