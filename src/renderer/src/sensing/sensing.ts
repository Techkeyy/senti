import {
  SmartSpectraSDK,
  ProcessingStatus,
  MetricType
} from '@smartspectra/node-sdk/renderer'
import { decodeMetrics, Metrics } from '@smartspectra/node-sdk/messages'

export type DecodedMetrics = ReturnType<typeof decodeMetrics>

export type SensingEvent =
  | { type: 'processingStatus'; status: number }
  | { type: 'validationStatus'; code: number; hint: string; sdkTs: number }
  | { type: 'error'; code: number; message: string; retryable: boolean }
  | { type: 'restart'; restarts: number; reason: string }
  | { type: 'busy'; message: string }
  | { type: 'running'; afterMs: number }
  | { type: 'note'; message: string }

export interface SensingOptions {
  apiKey: string
  /** Decoded sample (raw protobuf object) plus a compact plain-object copy for logging. */
  onSample: (m: DecodedMetrics, compact: Record<string, unknown>, sdkTs: number) => void
  onEvent: (e: SensingEvent) => void
  /** If the SDK is not running this long after start(), report "camera busy". */
  busyTimeoutMs?: number
}

const STOP_TIMEOUT_MS = 3000
const MIN_REBUILD_GAP_MS = 5000
const MAX_START_ATTEMPTS = 3

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Protobuf -> plain object, dropping landmark points and long traces (keeps counts). */
export function compact(m: DecodedMetrics): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o: any = Metrics.toObject(m, { longs: Number, enums: String, defaults: false })
  if (o.face?.landmarks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    o.face.landmarks = o.face.landmarks.map((l: any) => ({
      n: l.value?.length ?? 0,
      stable: l.stable,
      reset: l.reset,
      timestamp: l.timestamp
    }))
  }
  for (const [grp, keys] of [
    ['breathing', ['upperTrace', 'lowerTrace']],
    ['cardio', ['arterialPressureTrace']],
    ['eda', ['trace']]
  ] as const) {
    for (const k of keys) {
      if (o[grp]?.[k]) {
        o[grp][k + 'Count'] = o[grp][k].length
        delete o[grp][k]
      }
    }
  }
  return o
}

/**
 * Wraps the renderer SmartSpectra SDK around a host-owned MediaStream.
 * Recovery never calls sdk.reset() (it can block the event loop forever): it stops with a timeout,
 * destroys the instance and builds a new one. Events from older instances are ignored via a token.
 */
export class Sensing {
  restarts = 0
  /** Frames the SDK reported as sent through / not sent (cumulative across rebuilds). */
  framesSent = 0
  framesNotSent = 0
  status: number = ProcessingStatus.kUninitialized

  private sdk: SmartSpectraSDK | null = null
  private token = 0
  private stream: MediaStream | null = null
  private rebuilding = false
  private stopped = true
  private lastRebuildAt = 0
  private startedAt = 0
  private busyTimer: ReturnType<typeof setTimeout> | null = null
  private reachedRunning = false

  constructor(private opts: SensingOptions) {}

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream
    this.stopped = false
    this.restarts = 0
    await this.launch('initial')
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.token++
    this.clearBusy()
    await this.teardown()
  }

  /** Test hook / manual recovery: same path a real SDK error takes. */
  forceRebuild(reason: string): Promise<void> {
    return this.rebuild(reason, true)
  }

  private clearBusy(): void {
    if (this.busyTimer) clearTimeout(this.busyTimer)
    this.busyTimer = null
  }

  private build(): SmartSpectraSDK {
    const token = ++this.token
    const live = (): boolean => token === this.token && !this.stopped
    const sdk = new SmartSpectraSDK({
      apiKey: this.opts.apiKey,
      enableTelemetry: false,
      enableAccumulatedOutput: false,
      // Only what Senti uses: breathing rate, pulse rate, HRV, blinking, talking, expressions.
      // Skipping the 478-point face mesh and raw traces saves decode and copy work on slow laptops.
      requestedMetrics: [MetricType.BREATHING_RATE, MetricType.PULSE_RATE, MetricType.HRV, MetricType.FACE_LANDMARKS, MetricType.BLINKING, MetricType.TALKING, MetricType.EXPRESSIONS]
    })
    sdk.on('metrics', (buf, ts) => {
      if (!live()) return
      try {
        const m = decodeMetrics(buf)
        this.opts.onSample(m, compact(m), ts)
      } catch (e) {
        this.opts.onEvent({ type: 'error', code: -1, message: `decode: ${String(e)}`, retryable: false })
      }
    })
    sdk.on('validationStatus', (code, ts, hint) => {
      if (live()) this.opts.onEvent({ type: 'validationStatus', code, hint, sdkTs: ts })
    })
    sdk.on('processingStatus', (status) => {
      if (!live()) return
      this.status = status
      this.opts.onEvent({ type: 'processingStatus', status })
      if (status === ProcessingStatus.kRunning && !this.reachedRunning) {
        this.reachedRunning = true
        this.clearBusy()
        this.opts.onEvent({ type: 'running', afterMs: performance.now() - this.startedAt })
      }
      if (status === ProcessingStatus.kError) void this.rebuild('processingStatus kError')
    })
    sdk.on('frameSentThrough', (sent) => {
      if (!live()) return
      if (sent) this.framesSent++
      else this.framesNotSent++
    })
    sdk.on('error', (code, message, retryable) => {
      if (!live()) return
      this.opts.onEvent({ type: 'error', code, message, retryable })
      if (retryable) void this.rebuild(`retryable error ${code}`)
    })
    this.sdk = sdk
    return sdk
  }

  private async launch(reason: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
      if (this.stopped || !this.stream) return
      this.reachedRunning = false
      this.startedAt = performance.now()
      const sdk = this.build()
      const token = this.token
      try {
        sdk.useMediaStream(this.stream)
        this.armBusyTimer(token)
        await sdk.start()
        return
      } catch (e) {
        const err = e as { code?: number; message?: string }
        this.opts.onEvent({
          type: 'error',
          code: err.code ?? -1,
          message: `start failed (${reason}, attempt ${attempt}): ${err.message ?? String(e)}`,
          retryable: true
        })
        this.clearBusy()
        await this.teardown()
        await delay(1000)
      }
    }
    this.opts.onEvent({ type: 'note', message: `gave up starting after ${MAX_START_ATTEMPTS} attempts` })
  }

  private armBusyTimer(token: number): void {
    this.clearBusy()
    this.busyTimer = setTimeout(() => {
      if (token !== this.token || this.stopped || this.reachedRunning) return
      this.opts.onEvent({
        type: 'busy',
        message: `SDK not running ${(this.opts.busyTimeoutMs ?? 20000) / 1000}s after start. Camera busy in another app, or no network for the key check?`
      })
    }, this.opts.busyTimeoutMs ?? 20000)
  }

  /** Stop with a timeout, then destroy. Never reset(). */
  private async teardown(): Promise<void> {
    const sdk = this.sdk
    this.sdk = null
    if (!sdk) return
    await Promise.race([sdk.stop().catch(() => undefined), delay(STOP_TIMEOUT_MS)])
    try {
      sdk.destroy()
    } catch {
      /* already destroyed */
    }
  }

  private async rebuild(reason: string, force = false): Promise<void> {
    if (this.stopped || this.rebuilding) return
    const sinceLast = performance.now() - this.lastRebuildAt
    if (!force && sinceLast < MIN_REBUILD_GAP_MS) return
    this.rebuilding = true
    try {
      this.restarts++
      this.lastRebuildAt = performance.now()
      this.opts.onEvent({ type: 'restart', restarts: this.restarts, reason })
      this.clearBusy()
      this.token++ // invalidate the old instance's events right away
      await this.teardown()
      await delay(500)
      await this.launch(reason)
    } finally {
      this.rebuilding = false
    }
  }
}
