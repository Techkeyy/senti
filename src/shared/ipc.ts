export const IPC = {
  listSources: 'recorder:list-sources',
  selectSource: 'recorder:select-source',
  saveRecording: 'recorder:save-recording',
  spikeConfig: 'spike:config',
  spikeResult: 'spike:result',
  sensorConfig: 'sensor:config',
  sensorBegin: 'sensor:begin',
  sensorAppend: 'sensor:append',
  sensorSummary: 'sensor:summary'
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

export interface SensorConfig {
  /** Dev only: loaded from probe/.env by main. Never logged. */
  apiKey: string
  /** From SENTI_SENSOR_TEST, e.g. "rest:60,calm:180,tense:180". Empty when not auto-starting. */
  plan: string
  forceRebuild: boolean
  autoQuit: boolean
  /** Optional capture size from SENTI_SENSOR_RES, e.g. "640x480". Default 640x480. */
  resolution: string
}

export interface SensorRun {
  id: string
  logPath: string
}

export interface SentiApi {
  listSources(): Promise<CaptureSource[]>
  selectSource(id: string): Promise<void>
  saveRecording(data: ArrayBuffer): Promise<SaveRecordingResult>
  spikeConfig(): Promise<{ autotest: boolean }>
  spikeResult(result: unknown): Promise<void>
  sensorConfig(): Promise<SensorConfig>
  sensorBegin(): Promise<SensorRun>
  sensorAppend(id: string, lines: string): Promise<void>
  sensorSummary(id: string, summary: unknown): Promise<string>
}
