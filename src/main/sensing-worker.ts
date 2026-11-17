// OWNER: sensing builder. Runs inside an Electron utilityProcess (main-side controller: sensing.ts).
// Native SDK camera, face-only metrics, destroy-and-rebuild recovery, per-second SecondSample aggregation,
// SensingEvent + PreviewFrame messages to the parent. See src/shared/session.ts.
//
// Design notes
// - The SDK captures the camera itself (useCamera). NEVER call sdk.reset(): it blocks the event loop.
//   On kError we stop (3 s race), destroy, wait 500 ms, build a fresh SDK. A token ignores old instances.
// - Time bucketing: samples are bucketed by whole seconds from a phase origin, not by timer ticks.
//     play     : origin = playStartedAtMs, so t = floor((now - origin) / 1000) (0, 1, 2 ...).
//     baseline : origin = the moment baseline began; buckets are shifted when 'play' begins so the last
//                baseline second is t = -1 (sequential negative seconds: -N ... -1).
//     check    : nothing is stored.
// - face = more than 3 landmark packets that second, at least one of which moved (the SDK re-sends a frozen
//   face centre when nobody is in view, observed on this laptop), and no kNoFaceFound validation that second.
import { SmartSpectraSDK, CameraSelection, MetricType, ProcessingStatus } from '@smartspectra/node-sdk'
import { decodeMetrics } from '@smartspectra/node-sdk/messages'
import type { PreviewFrame, SecondSample, SensingEvent, SensingPhase, SensingState } from '../shared/session'
import type { FromWorker, SensingResult, ToWorker } from './sensing-protocol'

const parentPort = process.parentPort
const send = (m: FromWorker): void => parentPort.postMessage(m)

const SIGNALS = ['head motion', 'talking', 'expressions']
const BUSY_AFTER_MS = 20_000
const PREVIEW_MIN_GAP_MS = 125 // <= 8 fps
const PREVIEW_WIDTH = 320
const READY_MS = 3000
const EXPR = { FEAR: 4, NEUTRAL: 6, SURPRISE: 8 }

// SDK PixelFormat values: 0 RGB, 1 BGR, 2 RGBA, 3 BGRA (NV12 etc. are not converted).
const BYTES_PER_PX: Record<number, number> = { 0: 3, 1: 3, 2: 4, 3: 4 }

interface Acc {
  idx: number
  landmarkPackets: number
  /** Packets whose face centre actually moved (a frozen centre means the SDK is re-sending a stale face). */
  moved: number
  /** Validation reported kNoFaceFound during this second. */
  noFace: boolean
  speeds: number[]
  talkN: number
  talkYes: number
  exN: number
  fear: number
  surprise: number
  neutral: number
}

const newAcc = (idx: number): Acc => ({
  idx,
  landmarkPackets: 0,
  moved: 0,
  noFace: false,
  speeds: [],
  talkN: 0,
  talkYes: 0,
  exN: 0,
  fear: 0,
  surprise: 0,
  neutral: 0
})

let apiKey = ''
let sdk: SmartSpectraSDK | null = null
let token = 0
let on = false
let state: SensingState = 'off'
let message: string | undefined
let restarts = 0
let rebuilding = false
let startedAt = 0
let phase: SensingPhase = 'idle'
let phaseOrigin = 0
let hint = ''
let okSince: number | null = null
let prev: { x: number; y: number; t: number } | null = null
let acc: Acc | null = null
let baseline: SecondSample[] = []
let samples: SecondSample[] = []
let lastSample: SecondSample | undefined
let sampleTimer: NodeJS.Timeout | null = null
let statusTimer: NodeJS.Timeout | null = null
let lastPreviewAt = 0

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const r3 = (n: number): number => Math.round(n * 1000) / 1000

function finalize(a: Acc): SecondSample {
  const has = a.speeds.length > 0
  return {
    t: a.idx,
    face: a.landmarkPackets > 3 && a.moved > 0 && !a.noFace,
    headSpeedMax: has ? r3(Math.max(...a.speeds)) : null,
    headSpeedMedian: has ? r3(median(a.speeds)) : null,
    talking: a.talkN ? r3(a.talkYes / a.talkN) : null,
    fear: a.exN ? r3(a.fear / a.exN) : null,
    surprise: a.exN ? r3(a.surprise / a.exN) : null,
    neutral: a.exN ? r3(a.neutral / a.exN) : null,
    samples: a.landmarkPackets
  }
}

/** Close the open second (if any) into the list for the current phase. */
function flushAcc(): void {
  if (!acc) return
  const s = finalize(acc)
  acc = null
  if (phase === 'baseline') {
    baseline.push(s)
    lastSample = s
  } else if (phase === 'play') {
    samples.push(s)
    lastSample = s
  }
}

function currentAcc(now: number): Acc | null {
  if (phase !== 'baseline' && phase !== 'play') return null
  const idx = Math.floor((now - phaseOrigin) / 1000)
  if (acc && acc.idx !== idx) flushAcc()
  if (!acc) acc = newAcc(idx)
  return acc
}

function ingestMetrics(buf: Buffer): void {
  const now = Date.now()
  const m = decodeMetrics(buf)
  const a = currentAcc(now)
  for (const lm of m.face?.landmarks ?? []) {
    const pts = lm.value ?? []
    if (pts.length < 10) continue
    let sx = 0
    let sy = 0
    let minX = Infinity
    let maxX = -Infinity
    for (const p of pts) {
      const px = p.x ?? 0
      sx += px
      sy += p.y ?? 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
    }
    const c = { x: sx / pts.length, y: sy / pts.length, t: Number(lm.timestamp) / 1e6 }
    const w = maxX - minX
    if (a) a.landmarkPackets++
    if (prev && !lm.reset && c.t > prev.t && w > 0) {
      const speed = Math.hypot(c.x - prev.x, c.y - prev.y) / w / (c.t - prev.t)
      if (a && speed < 50) {
        a.speeds.push(speed)
        if (speed > 0) a.moved++
      }
    }
    prev = c
  }
  if (!a) return
  for (const t of m.face?.talking ?? []) {
    a.talkN++
    if (t.detected) a.talkYes++
  }
  for (const e of m.face?.expression ?? []) {
    a.exN++
    for (const s of e.scores ?? []) {
      const conf = s.confidence ?? 0
      if (s.type === EXPR.FEAR) a.fear += conf
      else if (s.type === EXPR.SURPRISE) a.surprise += conf
      else if (s.type === EXPR.NEUTRAL) a.neutral += conf
    }
  }
}

function handleVideo(buf: Buffer, w: number, h: number, stride: number, fmt: number): void {
  if (phase !== 'check') return
  const now = Date.now()
  if (now - lastPreviewAt < PREVIEW_MIN_GAP_MS) return
  const bpp = BYTES_PER_PX[fmt]
  if (!bpp || w <= 0 || h <= 0) return
  lastPreviewAt = now
  const ow = Math.min(PREVIEW_WIDTH, w)
  const oh = Math.max(1, Math.round((h * ow) / w))
  const rgba = new Uint8Array(ow * oh * 4)
  const bgr = fmt === 1 || fmt === 3
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / oh))
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / ow))
      const i = sy * stride + sx * bpp
      const o = (y * ow + x) * 4
      rgba[o] = bgr ? buf[i + 2] : buf[i]
      rgba[o + 1] = buf[i + 1]
      rgba[o + 2] = bgr ? buf[i] : buf[i + 2]
      rgba[o + 3] = 255
    }
  }
  const frame: PreviewFrame = { width: ow, height: oh, rgba }
  send({ type: 'preview', frame })
}

function build(): void {
  const my = ++token
  prev = null
  startedAt = Date.now()
  okSince = null
  hint = ''
  if (state !== 'recovering') state = 'starting'
  const s = new SmartSpectraSDK({
    apiKey,
    enableTelemetry: false,
    requestedMetrics: [MetricType.FACE_LANDMARKS, MetricType.TALKING, MetricType.EXPRESSIONS]
  })
  sdk = s
  s.on('metrics', (buf) => {
    if (my !== token) return
    try {
      ingestMetrics(buf)
    } catch {
      /* a bad packet must not kill sensing */
    }
  })
  s.on('validationStatus', (code, _ts, h) => {
    if (my !== token) return
    if (code === 0) {
      hint = ''
      if (okSince === null) okSince = Date.now()
    } else {
      hint = h || 'Adjust your position.'
      okSince = null
      if (code === 1 && acc) acc.noFace = true
    }
  })
  s.on('videoOutput', (buf, w, h, stride, fmt) => {
    if (my !== token) return
    try {
      handleVideo(buf, w, h, stride, fmt)
    } catch {
      /* ignore */
    }
  })
  s.on('processingStatus', (st) => {
    if (my !== token) return
    if (st === ProcessingStatus.kRunning) {
      state = 'running'
      message = undefined
    } else if (st === ProcessingStatus.kError) {
      void rebuild()
    }
  })
  s.on('error', () => {
    /* surfaced through processingStatus; keep the listener so the SDK never throws an unhandled 'error' */
  })
  try {
    const cams = SmartSpectraSDK.availableCameras()
    if (!cams.length) {
      state = 'error'
      message = 'No camera found. Plug one in and try again.'
      return
    }
    s.useCamera(CameraSelection.byId(cams[0].id))
    s.start()
  } catch (e) {
    state = 'error'
    message = e instanceof Error ? e.message : String(e)
  }
}

async function teardown(o: SmartSpectraSDK): Promise<void> {
  await Promise.race([o.stopAsync().catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
  await o.destroy().catch(() => {})
}

async function rebuild(): Promise<void> {
  if (rebuilding || !on) return
  rebuilding = true
  state = 'recovering'
  const old = sdk
  token++
  sdk = null
  if (old) await teardown(old)
  await new Promise((r) => setTimeout(r, 500))
  if (on) {
    restarts++
    build()
  }
  rebuilding = false
}

function statusEvent(): SensingEvent {
  const now = Date.now()
  // Camera busy: still not running 20 s after start (the SDK sits in kStarting with no error).
  if (on && state === 'starting' && now - startedAt > BUSY_AFTER_MS) {
    state = 'busy'
    message = 'Your camera is in use by another app. Close it and try again.'
  }
  const ready = state === 'running' && okSince !== null && now - okSince >= READY_MS
  const ev: SensingEvent = {
    status: { state, hint, ready, restarts, ...(message && (state === 'busy' || state === 'error') ? { message } : {}) }
  }
  if (lastSample) ev.sample = lastSample
  lastSample = undefined
  return ev
}

function startSensing(): void {
  if (on) return
  on = true
  restarts = 0
  rebuilding = false
  state = 'starting'
  message = undefined
  baseline = []
  samples = []
  acc = null
  lastSample = undefined
  phase = 'idle'
  build()
  sampleTimer = setInterval(() => {
    if (acc && acc.idx !== Math.floor((Date.now() - phaseOrigin) / 1000)) flushAcc()
    // While running, a second with no packets at all is still a sample (face=false), so a lost face shows up as a
    // look-away instead of a gap. During recovery no sample is created, so restart gaps stay "unknown".
    if (state === 'running') currentAcc(Date.now())
  }, 250)
  statusTimer = setInterval(() => {
    if (state === 'starting' || state === 'running' || state === 'recovering' || state === 'busy' || state === 'error') {
      send({ type: 'event', event: statusEvent() })
    }
  }, 1000)
}

function setPhase(p: SensingPhase, playStartedAtMs?: number): void {
  if (p === phase) return
  flushAcc()
  if (p === 'baseline') {
    phaseOrigin = Date.now()
    baseline = []
  } else if (p === 'play') {
    const n = baseline.length
    baseline = baseline.map((s) => ({ ...s, t: s.t - n })) // last baseline second becomes t = -1
    phaseOrigin = playStartedAtMs ?? Date.now()
    samples = []
  }
  phase = p
  prev = null // never compute speed across a phase boundary
  if (p !== 'check') lastPreviewAt = 0
}

async function stopSensing(): Promise<SensingResult> {
  flushAcc()
  const out = { baseline, samples, restarts, signals: SIGNALS }
  on = false
  state = 'off'
  token++
  if (sampleTimer) clearInterval(sampleTimer)
  if (statusTimer) clearInterval(statusTimer)
  sampleTimer = statusTimer = null
  const old = sdk
  sdk = null
  if (old) await teardown(old)
  phase = 'idle'
  baseline = []
  samples = []
  return out
}


parentPort.on('message', (e) => {
  const m = e.data as ToWorker
  try {
    if (m.type === 'start') {
      apiKey = m.apiKey
      startSensing()
    } else if (m.type === 'phase') {
      setPhase(m.phase, m.playStartedAtMs)
    } else if (m.type === 'stop') {
      void stopSensing().then((result) => {
        send({ type: 'stopped', result })
        setTimeout(() => process.exit(0), 50)
      })
    }
  } catch (err) {
    state = 'error'
    message = err instanceof Error ? err.message : String(err)
  }
})
