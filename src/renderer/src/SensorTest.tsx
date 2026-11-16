import { useEffect, useRef, useState } from 'react'
import { ProcessingStatus, SmartSpectraErrorCode, ValidationCode } from '@smartspectra/node-sdk/renderer'
import { Sensing, SegmentStats, cameraAuto, type SensingEvent } from './sensing'
import type { SensorConfig } from '../../shared/ipc'

const DEFAULT_PLAN = 'rest:60,calm:180,tense:180'
const FORCE_REBUILD_AFTER_MS = 15_000

const nameOf = (obj: Record<string, number>, v: number): string =>
  Object.keys(obj).find((k) => obj[k] === v) ?? String(v)

const BANNER: Record<string, string> = {
  rest: 'REST: sit still, look at the screen',
  calm: 'CALM: play the calm video',
  tense: 'TENSE: play the scary video'
}

interface Step {
  name: string
  secs: number
}

function parsePlan(plan: string): Step[] {
  return plan
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, secs] = p.split(':')
      return { name: name.trim().toLowerCase(), secs: Number(secs) }
    })
    .filter((s) => s.name && Number.isFinite(s.secs) && s.secs > 0)
}

interface Ui {
  phase: 'idle' | 'running' | 'done' | 'error'
  segment: string
  countdown: number
  total: number
  elapsed: number
  line: string
  status: string
  restarts: number
  warning: string
  logPath: string
  summary: string
}

const initialUi: Ui = {
  phase: 'idle',
  segment: '',
  countdown: 0,
  total: 0,
  elapsed: 0,
  line: '',
  status: 'idle',
  restarts: 0,
  warning: '',
  logPath: '',
  summary: ''
}

const f = (v: number | null | undefined, d = 0): string => (v == null ? '-' : v.toFixed(d))

export default function SensorTest({ config, onBack }: { config: SensorConfig; onBack?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const startedRef = useRef(false)
  const [planText, setPlanText] = useState(config.plan || DEFAULT_PLAN)
  const [ui, setUi] = useState<Ui>(initialUi)

  async function run(planStr: string): Promise<void> {
    const steps = parsePlan(planStr)
    if (!steps.length) {
      setUi((u) => ({ ...u, phase: 'error', warning: 'Bad plan. Use name:seconds,name:seconds' }))
      return
    }
    const total = steps.reduce((a, s) => a + s.secs, 0)
    const t0 = performance.now()
    const nowMs = (): number => performance.now() - t0
    let stream: MediaStream | null = null
    let sensing: Sensing | null = null
    let tickId: ReturnType<typeof setInterval> | null = null
    let flushId: ReturnType<typeof setInterval> | null = null
    let fpsId: ReturnType<typeof setInterval> | null = null
    let seg = steps[0].name
    let sdkStatus = 'idle'
    let hint = '-'
    let warning = ''
    let buf: string[] = []
    let runId = ''
    const errors: { tMs: number; segment: string; code: number; name: string; message: string; retryable: boolean }[] = []
    const statusTransitions: { tMs: number; status: string }[] = []
    let timeToRunningMs: number | null = null
    let lastValidationKey = ''

    const log = (type: string, sdkTs: number | null, payload: unknown): void => {
      buf.push(JSON.stringify({ t: +nowMs().toFixed(1), seg, type, sdkTs, payload }) + '\n')
    }
    const flush = async (): Promise<void> => {
      if (!buf.length || !runId) return
      const text = buf.join('')
      buf = []
      await window.senti.sensorAppend(runId, text)
    }

    try {
      setUi({ ...initialUi, phase: 'running', segment: seg, total, status: 'starting camera' })
      const [rw, rh] = (config.resolution || '640x480').split('x').map(Number)
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: rw || 640 }, height: { ideal: rh || 480 }, frameRate: { ideal: 30 } }
      })
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      const track = stream.getVideoTracks()[0]
      // The SDK locks exposure/white balance/focus to manual and never restores them (SDK issue #19),
      // so the camera can start near-black. Hand the SDK a camera in automatic mode, settled.
      await cameraAuto(track)
      await new Promise((r) => setTimeout(r, 1500))
      const run0 = await window.senti.sensorBegin()
      runId = run0.id
      const stats = new SegmentStats(nowMs, seg)
      log('start', null, {
        plan: steps,
        camera: track.label,
        settings: track.getSettings(),
        capabilities: track.getCapabilities?.(),
        sdk: 'renderer useMediaStream',
        forceRebuild: config.forceRebuild
      })
      log('segment', null, { segment: seg })
      flushId = setInterval(() => void flush().catch(() => undefined), 1000)
      // Camera frame-rate diagnostic: frames actually painted from the stream vs the SDK's sent counter.
      let vFrames = 0
      const vTick = (): void => {
        vFrames++
        video?.requestVideoFrameCallback(vTick)
      }
      video?.requestVideoFrameCallback(vTick)
      let lastF = 0
      let lastSent = 0
      let lastNot = 0
      let lastT = nowMs()
      const probeCanvas = document.createElement('canvas')
      probeCanvas.width = 32
      probeCanvas.height = 24
      const meanLuma = (): number | null => {
        try {
          const c = probeCanvas.getContext('2d', { willReadFrequently: true })!
          c.drawImage(video!, 0, 0, 32, 24)
          const d = c.getImageData(0, 0, 32, 24).data
          let s = 0
          for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          return +(s / (d.length / 4)).toFixed(1)
        } catch {
          return null
        }
      }
      fpsId = setInterval(() => {
        const luma = meanLuma()
        // If the SDK's exposure lock collapsed the image, put the camera back in automatic mode
        // (the SDK's own native camera path does the same: "exposure reverted to AUTO").
        if (luma != null && luma < 25) {
          void cameraAuto(track)
          log('note', null, { message: `image dark (luma ${luma}), camera set back to automatic exposure` })
        }
        const dt = (nowMs() - lastT) / 1000
        const sent = sensing?.framesSent ?? 0
        const not = sensing?.framesNotSent ?? 0
        log('fps', null, {
          previewFps: +((vFrames - lastF) / dt).toFixed(1),
          sdkSentPerSec: +((sent - lastSent) / dt).toFixed(1),
          sdkNotSentPerSec: +((not - lastNot) / dt).toFixed(1),
          trackFps: track.getSettings().frameRate,
          meanLuma: meanLuma() // 0-255 brightness of the camera image, to tell a dark room from no face
        })
        lastF = vFrames
        lastSent = sent
        lastNot = not
        lastT = nowMs()
      }, 5000)

      const onEvent = (e: SensingEvent): void => {
        switch (e.type) {
          case 'processingStatus': {
            sdkStatus = nameOf(ProcessingStatus as unknown as Record<string, number>, e.status)
            statusTransitions.push({ tMs: +nowMs().toFixed(1), status: sdkStatus })
            log('processingStatus', null, { status: e.status, name: sdkStatus })
            break
          }
          case 'validationStatus': {
            const n = nameOf(ValidationCode as unknown as Record<string, number>, e.code)
            hint = e.code === ValidationCode.kOk ? 'ok' : `${n}${e.hint ? ` (${e.hint})` : ''}`
            if (e.code !== ValidationCode.kOk) stats.validation(n)
            // Log changes only: the raw stream repeats the same code every frame.
            const key = `${e.code}|${e.hint}`
            if (key !== lastValidationKey) {
              lastValidationKey = key
              log('validationStatus', e.sdkTs, { code: e.code, name: n, hint: e.hint })
            }
            break
          }
          case 'error': {
            const n = nameOf(SmartSpectraErrorCode as unknown as Record<string, number>, e.code)
            errors.push({ tMs: +nowMs().toFixed(1), segment: seg, code: e.code, name: n, message: e.message, retryable: e.retryable })
            log('error', null, { code: e.code, name: n, message: e.message, retryable: e.retryable })
            break
          }
          case 'restart':
            lastValidationKey = ''
            log('restart', null, { restarts: e.restarts, reason: e.reason })
            break
          case 'busy':
            warning = e.message
            log('busy', null, { message: e.message })
            break
          case 'running':
            if (timeToRunningMs == null) timeToRunningMs = +e.afterMs.toFixed(0)
            warning = ''
            log('running', null, { afterMs: e.afterMs })
            break
          case 'note':
            log('note', null, { message: e.message })
            break
        }
      }

      sensing = new Sensing({
        apiKey: config.apiKey,
        onEvent,
        onSample: (m, compactObj, sdkTs) => {
          log('metrics', sdkTs, compactObj)
          stats.ingest(m)
        }
      })
      if (!config.apiKey) throw new Error('No API key found (probe/.env SENTI_PRESAGE_KEY)')
      await sensing.start(stream)

      let forced = false
      const segEnds: number[] = []
      steps.reduce((acc, s) => (segEnds.push(acc + s.secs * 1000), acc + s.secs * 1000), 0)

      await new Promise<void>((resolve) => {
        tickId = setInterval(() => {
          const el = nowMs()
          let idx = segEnds.findIndex((end) => el < end)
          if (idx < 0) idx = steps.length
          if (idx >= steps.length) {
            resolve()
            return
          }
          if (steps[idx].name !== seg) {
            seg = steps[idx].name
            stats.setSegment(seg)
            log('segment', null, { segment: seg })
          }
          if (config.forceRebuild && !forced && el > FORCE_REBUILD_AFTER_MS) {
            forced = true
            void sensing!.forceRebuild('SENTI_SENSOR_FORCE_REBUILD')
          }
          const l = stats.live
          const exprTxt = l.expr ? `${l.expr.name} ${f(l.expr.value)}%` : '-'
          const line =
            `pulse ${l.pulse ? `${f(l.pulse.value)} bpm (conf ${f(l.pulse.confidence)}${l.pulse.stable ? ', stable' : ''})` : '-'}` +
            ` | breathing ${l.breath ? `${f(l.breath.value)} /min (conf ${f(l.breath.confidence)})` : '-'}` +
            ` | expr ${exprTxt} | talking ${l.talk ?? '-'} | blink ${l.blink ?? '-'} | validation ${hint}`
          setUi((u) => ({
            ...u,
            phase: 'running',
            segment: seg,
            countdown: Math.ceil((segEnds[idx] - el) / 1000),
            elapsed: Math.floor(el / 1000),
            line,
            status: sdkStatus,
            restarts: sensing!.restarts,
            warning
          }))
        }, 250)
      })

      if (tickId) clearInterval(tickId)
      if (fpsId) clearInterval(fpsId)
      const restarts = sensing.restarts
      await sensing.stop()
      sensing = null
      log('end', null, { restarts })
      const summary = {
        runId,
        plan: steps,
        totalSec: total,
        wallSec: +(nowMs() / 1000).toFixed(1),
        camera: track.label,
        timeToRunningMs,
        restarts,
        statusTransitions,
        errors,
        segments: stats.summarize()
      }
      if (flushId) clearInterval(flushId)
      await flush()
      const path = await window.senti.sensorSummary(runId, summary)
      setUi((u) => ({ ...u, phase: 'done', segment: '', summary: JSON.stringify(summary, null, 2), logPath: `${run0.logPath}\n${path}`, restarts }))
    } catch (e) {
      const err = e as Error
      if (tickId) clearInterval(tickId)
      if (flushId) clearInterval(flushId)
      if (fpsId) clearInterval(fpsId)
      try {
        log('fatal', null, { message: String(err.message ?? e) })
        await flush()
        await sensing?.stop()
      } catch {
        /* ignore */
      }
      setUi((u) => ({ ...u, phase: 'error', warning: `${err.name}: ${err.message}` }))
      console.error('SENTI_SENSOR_ERROR', err.message)
    } finally {
      for (const t of stream?.getVideoTracks() ?? []) await cameraAuto(t)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }

  useEffect(() => {
    if (config.plan && !startedRef.current) {
      startedRef.current = true
      void run(config.plan)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const banner = BANNER[ui.segment] ?? ui.segment.toUpperCase()
  const bg = ui.segment === 'tense' ? '#7a1010' : ui.segment === 'calm' ? '#134d2c' : '#1f2d4a'

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1 style={{ margin: '0 0 8px' }}>Senti sensor test</h1>
      {ui.phase === 'idle' && (
        <p>
          {onBack && <button onClick={onBack}>Back</button>}{' '}
          <input style={{ width: 340 }} value={planText} onChange={(e) => setPlanText(e.target.value)} />{' '}
          <button onClick={() => void run(planText)}>Start sensor test</button>
        </p>
      )}
      <video ref={videoRef} muted width={320} height={240} style={{ background: '#000' }} />
      {ui.phase === 'running' && (
        <div style={{ background: bg, color: '#fff', padding: 24, margin: '12px 0', borderRadius: 8 }}>
          <div style={{ fontSize: 48, fontWeight: 800 }}>{banner}</div>
          <div style={{ fontSize: 72, fontWeight: 800 }}>{ui.countdown}s</div>
          <div>
            elapsed {ui.elapsed}s of {ui.total}s
          </div>
        </div>
      )}
      <p style={{ fontFamily: 'monospace', fontSize: 15 }}>{ui.line}</p>
      <p style={{ fontFamily: 'monospace' }}>
        SDK status: {ui.status} | restarts: {ui.restarts}
      </p>
      {ui.warning && <p style={{ color: 'crimson', fontWeight: 700 }}>{ui.warning}</p>}
      {ui.phase === 'done' && (
        <>
          <h2>Done</h2>
          <p style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{ui.logPath}</p>
          <pre style={{ background: '#111', color: '#cfc', padding: 12, maxHeight: 360, overflow: 'auto', fontSize: 12 }}>{ui.summary}</pre>
        </>
      )}
    </div>
  )
}
