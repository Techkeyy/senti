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
import { constants, getPriority, setPriority } from 'node:os'
import type { PreviewFrame, SecondSample, SensingEvent, SensingPhase, SensingState } from '../shared/session'
import type { FromWorker, SensingResult, ToWorker } from './sensing-protocol'
import { noteRebuild } from './rebuild-budget'

const parentPort = process.parentPort

// Presage stops itself below ~25 fps. On a 2-core laptop with a game (or video) and the screen recorder
// running, it fell to 0 to 14 fps and restarted every ~20 s. At high priority it held 30 fps with 0
// restarts under the same load, while the recorder and the video gave way slightly (measured 17 Nov).
// HIGH is allowed without admin rights on Windows; failing to set it is not fatal.
try {
  setPriority(0, constants.priority.PRIORITY_HIGH)
} catch {
  /* keep normal priority */
}
const send = (m: FromWorker): void => parentPort.postMessage(m)

const SIGNALS = ['head motion', 'talking', 'expressions']
const BUSY_AFTER_MS = 20_000
const PREVIEW_MIN_GAP_MS = 125 // <= 8 fps
const PREVIEW_WIDTH = 320
const READY_MS = 3000
// Credits are metered: a camera check or baseline left open this long is stopped.
const IDLE_STOP_MS = 5 * 60_000
const IDLE_MESSAGE = 'Paused to save Presage credits. Press Retry to continue.'
const REBUILD_LOOP_MESSAGE = 'Senti cannot keep the camera reader running. Check your internet connection and camera, then Retry.'
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
/** Set by an error a restart cannot fix (credits, key). Cleared when sensing starts again. */
let fatalError = false
// SmartSpectraErrorCode values: kAuthenticationFailed = 2, kCreditExhausted = 4, kMetricNotAuthorized = 13.
const FATAL_ERRORS: Record<number, string> = {
  2: 'Presage did not accept your API key. Check it in Settings.',
  4: 'Your Presage measurement credits are used up. Ask Presage for more (their Discord is linked from the challenge page), then try again.',
  13: 'Your Presage key is not allowed to read face signals. Check your Presage plan.'
}
let state: SensingState = 'off'
let message: string | undefined
let restarts = 0
let rebuilding = false
let rebuildTimes: number[] = []
let idleTimer: NodeJS.Timeout | null = null
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
  setPreviewListener(s, phase === 'check')
  s.on('processingStatus', (st) => {
    if (my !== token) return
    if (st === ProcessingStatus.kRunning) {
      state = 'running'
      message = undefined
    } else if (st === ProcessingStatus.kError) {
      void rebuild()
    }
  })
  s.on('error', (code) => {
    // Fatal codes apply whichever instance reports them, so the token is not checked here.
    // Errors a restart cannot fix: stop and tell the user instead of rebuilding forever
    // (seen 17 Nov: kCreditExhausted produced 15 rebuilds in 55 s with no data).
    const fatal = FATAL_ERRORS[code]
    if (fatal) {
      fatalError = true
      state = 'error'
      message = fatal
    }
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
  if (rebuilding || !on || fatalError) return
  rebuilding = true
  const budget = noteRebuild(rebuildTimes, Date.now())
  rebuildTimes = budget.times
  const old = sdk
  token++
  sdk = null
  if (!budget.ok) {
    // Too many restarts in a short time: stop instead of rebuilding forever (and spending credits).
    fatalError = true
    state = 'error'
    message = REBUILD_LOOP_MESSAGE
    if (old) await teardown(old)
    rebuilding = false
    return
  }
  state = 'recovering'
  if (old) await teardown(old)
  await new Promise((r) => setTimeout(r, 500))
  if (on && !fatalError) {
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
    message = 'Senti cannot start your camera. Close other apps using it, and check Windows Settings > Privacy > Camera allows desktop apps.'
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
  rebuildTimes = []
  fatalError = false
  state = 'starting'
  message = undefined
  baseline = []
  samples = []
  acc = null
  lastSample = undefined
  phase = 'idle'
  build()
  armIdle()
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

/**
 * Preview frames are only needed on the camera-check screen. While a videoOutput listener exists the SDK
 * hands every camera frame to JS, which cut face processing from ~28 to ~5 fps on the owner's 2-core laptop
 * (measured 17 Nov). So the listener exists only in phase 'check'. The SDK (pinned 3.5.0) has no off();
 * its listeners live in a private Map, which is deleted from directly.
 */
function setPreviewListener(s: SmartSpectraSDK, on: boolean): void {
  if (on) {
    const my = token
    s.on('videoOutput', (buf, w, h, stride, fmt) => {
      if (my !== token) return
      try {
        handleVideo(buf, w, h, stride, fmt)
      } catch {
        /* ignore */
      }
    })
  } else {
    ;(s as unknown as { _listeners?: Map<string, unknown> })._listeners?.delete('videoOutput')
  }
}

/** Stops the camera reader after IDLE_STOP_MS outside play. Re-armed on every phase change. */
function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (!on || phase === 'play') return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (!on || phase === 'play') return
    fatalError = true // no rebuild, and no restart from the SDK's own error events
    state = 'error'
    message = IDLE_MESSAGE
    token++
    const old = sdk
    sdk = null
    if (old) void teardown(old)
  }, IDLE_STOP_MS)
}

function setPhase(p: SensingPhase, playStartedAtMs?: number): void {
  // Entering 'baseline' again (Redo baseline) restarts the baseline; any other repeat is a no-op.
  if (p === phase && p !== 'baseline') return
  if (sdk) setPreviewListener(sdk, p === 'check')
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
  armIdle()
}

/** Collects the result and detaches the SDK synchronously; the slow teardown is returned for the caller to await AFTER replying. */
function stopSensing(): { result: SensingResult; teardown: Promise<void> } {
  flushAcc()
  const out = { baseline, samples, restarts, signals: SIGNALS }
  on = false
  state = 'off'
  token++
  if (sampleTimer) clearInterval(sampleTimer)
  if (statusTimer) clearInterval(statusTimer)
  sampleTimer = statusTimer = null
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const old = sdk
  sdk = null
  phase = 'idle'
  baseline = []
  samples = []
  return { result: out, teardown: old ? teardown(old) : Promise.resolve() }
}


parentPort.on('message', (e) => {
  const m = e.data as ToWorker
  try {
    if (m.type === 'packageCheck') {
      // Dev-only (SENTI_PACKAGE_CHECK): proves the SDK and its native runtime load. Enumerates cameras, never opens one.
      const cams = SmartSpectraSDK.availableCameras()
      send({ type: 'packageCheck', info: { ok: true, version: SmartSpectraSDK.version, cameras: cams.length, priority: getPriority(0) } })
    } else if (m.type === 'start') {
      apiKey = m.apiKey
      startSensing()
    } else if (m.type === 'phase') {
      setPhase(m.phase, m.playStartedAtMs)
    } else if (m.type === 'stop') {
      // Reply first: a hanging stop/destroy must not lose the data. Main kills this process shortly after.
      const { result, teardown: done } = stopSensing()
      send({ type: 'stopped', result })
      void done.finally(() => setTimeout(() => process.exit(0), 50))
    }
  } catch (err) {
    state = 'error'
    message = err instanceof Error ? err.message : String(err)
  }
})
