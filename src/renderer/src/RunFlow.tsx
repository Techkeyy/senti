import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, HardDrive, Info, Keyboard, MonitorPlay, User } from 'lucide-react'
import type { SecondSample, SensingStatus, Session } from '../../shared/session'
import { computeReport } from '../../shared/felt'
import { RecorderAbortError, startRecording, type ActiveRecording } from './useRecorder'
import { cleanErr, type Draft } from './screens1'
import { fmt, levelAt, newSessionId, plural } from './util'
import { Shell } from './Shell'
import Timeline from './Timeline'
import LiveTrace, { type TracePoint } from './LiveTrace'
import { devStatus, synthSample, type DevSim } from './devSim'

type Phase = 'consent' | 'camera' | 'baseline' | 'ready' | 'play' | 'saving' | 'save-failed' | 'saved'
const BASELINE_SEC = 30
/** Fewer face seconds than this in the baseline gets a warning on the Ready screen. */
const MIN_BASELINE_FACE_SEC = 10

const TIPS = 'Face the screen, light in front of you, shoulders in view, only you in the picture.'

interface Props {
  draft: Draft
  initialPhase?: Phase
  /** Dev screenshots only: synthetic readings, and the camera is never opened. */
  devSim?: DevSim
  onCancel: () => void
  onSaved: (id: string) => void
}

/** Keeps one sample per whole second, the later one winning, like the report does. */
function upsert(list: SecondSample[], s: SecondSample): void {
  const k = Math.floor(s.t)
  const i = list.findIndex((x) => Math.floor(x.t) === k)
  if (i >= 0) list[i] = s
  else list.push(s)
}

function Ring({ on }: { on: boolean }) {
  return (
    <svg className={`ring${on ? ' on' : ''}`} width={44} height={44} viewBox="0 0 44 44" aria-hidden="true">
      <circle className="ring-bg" cx={22} cy={22} r={18} fill="none" strokeWidth={3} />
      <circle className="ring-fg" cx={22} cy={22} r={18} fill="none" strokeWidth={3} strokeLinecap="round" pathLength={100} transform="rotate(-90 22 22)" />
      {on && <Check x={14} y={14} size={16} strokeWidth={1.75} color="var(--pos)" className="ring-check" />}
    </svg>
  )
}

export default function RunFlow({ draft, initialPhase = 'consent', devSim, onCancel, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [status, setStatus] = useState<SensingStatus | null>(() => (devSim && initialPhase === 'camera' ? devStatus(devSim) : null))
  const [sample, setSample] = useState<SecondSample | null>(null)
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)
  const [baselineLeft, setBaselineLeft] = useState(BASELINE_SEC)
  const [elapsed, setElapsed] = useState(0)
  const [markerCount, setMarkerCount] = useState(0)
  const [notice, setNotice] = useState('')
  const [saveError, setSaveError] = useState('')
  const [trace, setTrace] = useState<TracePoint[]>([])
  const [tick, setTick] = useState(0)
  const [hotkeysOk, setHotkeysOk] = useState(true)
  const [baseFace, setBaseFace] = useState(BASELINE_SEC)
  const [savedId, setSavedId] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const consentAt = useRef('')
  const sensingOn = useRef(false)
  const mounted = useRef(true)
  const beginPlayInFlight = useRef(false)
  const playAbort = useRef<AbortController | null>(null)
  const camStarting = useRef(false)
  /** Set when the saved playtest has missing or no reaction data; shown on the "saved" screen before the report. */
  const dataNotice = useRef('')
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const recording = useRef<ActiveRecording | null>(null)
  const markers = useRef<number[]>([])
  const stopping = useRef(false)
  const pending = useRef<{ session: Session; blob: Blob | null } | null>(null)
  // Readings seen by this window, only to draw the live strips. The saved ones come from sensingStop.
  const baseSeen = useRef<SecondSample[]>([])
  const playSeen = useRef<SecondSample[]>([])

  const ingest = useCallback((s: SecondSample): void => {
    setSample(s)
    const ph = phaseRef.current
    if (ph !== 'baseline' && ph !== 'play') return
    const v = s.face && s.headSpeedMax !== null ? s.headSpeedMax : null
    setTrace((prev) => [...prev.slice(-120), { ts: Date.now(), v }])
    if (ph === 'baseline') upsert(baseSeen.current, s)
    else {
      upsert(playSeen.current, s)
      setTick((n) => n + 1)
    }
  }, [])

  // Push subscriptions live for the whole flow.
  useEffect(() => {
    const offEvent = window.senti.onSensingEvent((e) => {
      setStatus(e.status)
      if (e.sample) ingest(e.sample)
    })
    const offPreview = window.senti.onPreview((f) => {
      const c = canvasRef.current
      if (!c) return
      if (c.width !== f.width || c.height !== f.height) {
        c.width = f.width
        c.height = f.height
      }
      const data = new Uint8ClampedArray(f.width * f.height * 4)
      data.set(f.rgba.subarray(0, data.length))
      c.getContext('2d')?.putImageData(new ImageData(data, f.width, f.height), 0, 0)
    })
    return () => {
      offEvent()
      offPreview()
    }
  }, [ingest])

  // Release everything if the flow is left in any way.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      playAbort.current?.abort() // a recorder still starting stops itself and rejects
      sensingOn.current = false
      void window.senti.sensingStop().catch(() => undefined) // idempotent: needed even when sensingOn is false (a start may be in flight)
      void window.senti.hotkeysEnable(false).catch(() => undefined)
      void window.senti.setBusy(false).catch(() => undefined)
      if (recording.current) void recording.current.stop().catch(() => undefined)
    }
  }, [])

  // Closing the window asks first while a playtest runs or is being saved.
  const busy = phase === 'play' || phase === 'saving' || phase === 'save-failed'
  useEffect(() => {
    void window.senti.setBusy(busy).catch(() => undefined)
  }, [busy])

  const startCamera = useCallback(async () => {
    if (camStarting.current) return
    camStarting.current = true
    setStarting(true)
    setStartError('')
    setStatus(null)
    try {
      if (sensingOn.current) {
        sensingOn.current = false
        await window.senti.sensingStop().catch(() => undefined)
      }
      if (!mounted.current) return // the unmount cleanup already stopped sensing
      await window.senti.sensingStart()
      if (!mounted.current) {
        // Left the flow while the worker was starting: stop what just started.
        void window.senti.sensingStop().catch(() => undefined)
        return
      }
      sensingOn.current = true
      await window.senti.sensingPhase('check')
      if (!mounted.current) void window.senti.sensingStop().catch(() => undefined)
    } catch (e) {
      if (mounted.current) setStartError(cleanErr(e))
    } finally {
      camStarting.current = false
      if (mounted.current) setStarting(false)
    }
  }, [])

  /** From the baseline or Ready screen: go back to the camera check and restart the camera reader. */
  function backToCheck(): void {
    setStartError('')
    setPhase('camera')
    if (sensingOn.current) void startCamera()
  }

  // Camera check begins as soon as that phase is entered (never in the dev simulation).
  useEffect(() => {
    if (phase === 'camera' && !sensingOn.current && !devSim) void startCamera()
  }, [phase, startCamera, devSim])

  // Baseline countdown. Paused while the camera reader is in trouble (the Retry on screen restarts the check).
  const baselineProblem = phase === 'baseline' && (status?.state === 'error' || status?.state === 'busy')
  useEffect(() => {
    if (phase !== 'baseline' || baselineProblem) return
    const t0 = Date.now()
    const id = setInterval(() => {
      const left = Math.max(0, BASELINE_SEC - Math.floor((Date.now() - t0) / 1000))
      setBaselineLeft(left)
      if (left === 0) {
        clearInterval(id)
        setBaseFace(baseSeen.current.filter((x) => x.face).length)
        setPhase('ready')
      }
    }, 250)
    return () => clearInterval(id)
  }, [phase, baselineProblem])

  // Play clock.
  useEffect(() => {
    if (phase !== 'play') return
    const id = setInterval(() => {
      if (recording.current) setElapsed((Date.now() - recording.current.startedAtMs) / 1000)
    }, 250)
    return () => clearInterval(id)
  }, [phase])

  // Dev simulation of the live screens: seeded history, then one synthetic reading per second.
  useEffect(() => {
    if (!devSim || (phase !== 'baseline' && phase !== 'play')) return
    const now = Date.now()
    if (phase === 'baseline') {
      baseSeen.current = []
      const seed: TracePoint[] = []
      for (let i = 0; i < 14; i++) {
        const s = synthSample(i - BASELINE_SEC)
        s.headSpeedMax = s.face ? 0.1 + 0.12 * Math.abs(Math.sin(i * 1.3)) : null
        baseSeen.current.push(s)
        seed.push({ ts: now - (14 - i) * 1000, v: s.headSpeedMax })
      }
      setTrace(seed)
      setSample(baseSeen.current[13])
      let n = 14
      const id = setInterval(() => {
        const s = synthSample(n - BASELINE_SEC)
        s.headSpeedMax = 0.1 + 0.12 * Math.abs(Math.sin(n * 1.3))
        n++
        ingest(s)
      }, 1000)
      return () => clearInterval(id)
    }
    const START = 134
    baseSeen.current = []
    for (let i = -30; i < 0; i++) baseSeen.current.push({ ...synthSample(i), headSpeedMax: 0.1 + 0.12 * Math.abs(Math.sin(i * 1.3)) })
    playSeen.current = []
    const seed: TracePoint[] = []
    for (let t = 0; t < START; t++) {
      const s = synthSample(t)
      playSeen.current.push(s)
      if (t >= START - 60) seed.push({ ts: now - (START - t) * 1000, v: s.face ? s.headSpeedMax : null })
    }
    setTrace(seed)
    setTick((x) => x + 1)
    setSample(playSeen.current[START - 1])
    setStatus({ state: 'running', hint: '', ready: true, restarts: 0 })
    setMarkerCount(2)
    markers.current = [72, 118]
    setElapsed(START)
    let t = START
    const id = setInterval(() => {
      ingest(synthSample(t))
      t++
      setElapsed(t)
    }, 1000)
    return () => clearInterval(id)
  }, [devSim, phase, ingest])

  async function beginBaseline(): Promise<void> {
    try {
      await window.senti.sensingPhase('baseline')
      baseSeen.current = []
      setTrace([])
      setSample(null)
      setBaselineLeft(BASELINE_SEC)
      setPhase('baseline')
    } catch (e) {
      setStartError(cleanErr(e))
    }
  }

  async function beginPlay(): Promise<void> {
    if (beginPlayInFlight.current) return
    beginPlayInFlight.current = true
    const abort = new AbortController()
    playAbort.current = abort
    setStarting(true)
    setStartError('')
    stopping.current = false
    let rec: ActiveRecording | null = null
    // After every await: if the flow was left meanwhile, undo what just resolved and do nothing else.
    const abandon = async (): Promise<void> => {
      void window.senti.hotkeysEnable(false).catch(() => undefined)
      if (rec) await rec.stop().catch(() => undefined)
      recording.current = null
    }
    try {
      rec = await startRecording(() => void finish(), abort.signal)
      if (!mounted.current || abort.signal.aborted) return await abandon()
      recording.current = rec
      markers.current = []
      playSeen.current = []
      setTrace([])
      setSample(null)
      setMarkerCount(0)
      setElapsed(0)
      await window.senti.sensingPhase('play', rec.startedAtMs)
      if (!mounted.current) return await abandon()
      let keysOk = true
      try {
        await window.senti.hotkeysEnable(true)
        setNotice('')
      } catch (e) {
        keysOk = false
        setNotice(`Keyboard shortcuts are unavailable (${cleanErr(e)}). Senti stays on screen; use the Stop button to finish.`)
      }
      if (!mounted.current) return await abandon()
      setHotkeysOk(keysOk)
      setPhase('play')
      // Step aside so the game can be in front. The recorder has really started at this point.
      // Not when the hotkeys failed: the player would have no way to stop except by finding this window.
      if (keysOk) void window.senti.windowMinimize().catch(() => undefined)
    } catch (e) {
      if (rec) {
        await rec.stop().catch(() => undefined)
        recording.current = null
      }
      if (mounted.current && !(e instanceof RecorderAbortError)) setStartError(cleanErr(e))
    } finally {
      beginPlayInFlight.current = false
      if (mounted.current) setStarting(false)
    }
  }

  const finish = useCallback(async (): Promise<void> => {
    const rec = recording.current
    if (!rec || stopping.current || phaseRef.current !== 'play') return
    stopping.current = true
    setPhase('saving')
    setSaveError('')
    void window.senti.windowRestore().catch(() => undefined)
    const stoppedAt = Date.now()
    void window.senti.hotkeysEnable(false).catch(() => undefined)
    const blob = await rec.stop()
    recording.current = null
    let result: Awaited<ReturnType<typeof window.senti.sensingStop>> = { baseline: [], samples: [], restarts: 0, signals: [] }
    let sensingFailed = false
    try {
      result = await window.senti.sensingStop()
    } catch {
      sensingFailed = true
    }
    sensingOn.current = false
    let baseline = result.baseline
    let samples = result.samples
    let note = ''
    if (samples.length === 0) {
      if (playSeen.current.length > 0) {
        // The camera reader died or timed out without returning its data: use what this window saw live.
        samples = [...playSeen.current].sort((a, b) => a.t - b.t)
        if (baseline.length === 0 && baseSeen.current.length > 0) {
          const n = baseSeen.current.length
          baseline = baseSeen.current.map((x) => ({ ...x, t: x.t - n })) // last baseline second is t = -1, as in the worker
        }
        note = 'Some readings may be missing: the camera reader stopped early.'
      } else if (sensingFailed) {
        note = 'The camera reader did not return its readings, so this playtest has no reaction data.'
      } else {
        note = 'Senti did not get any camera readings during this playtest, so the report has no reaction data. Check your camera and internet connection before the next one.'
      }
    }
    dataNotice.current = note
    setNotice(note)
    const session: Session = {
      id: newSessionId(),
      name: draft.name,
      createdAt: new Date(rec.startedAtMs).toISOString(),
      plannedSec: draft.plannedSec,
      intended: draft.intended,
      beats: draft.beats,
      markers: markers.current.map((t) => ({ t })),
      baseline,
      samples,
      playStartedAtMs: rec.startedAtMs,
      playedSec: Math.round(((stoppedAt - rec.startedAtMs) / 1000) * 10) / 10,
      recording: null,
      sensing: { restarts: result.restarts, signals: result.signals },
      consent: { acceptedAt: consentAt.current }
    }
    pending.current = { session, blob }
    await save()
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(): Promise<void> {
    const p = pending.current
    if (!p) return
    setPhase('saving')
    setSaveError('')
    try {
      const buf = p.blob && p.blob.size > 0 ? await p.blob.arrayBuffer() : null
      await window.senti.sessionsSave(p.session, buf)
      pending.current = null
      if (dataNotice.current) {
        // Do not drop the user straight into the report: say first that readings are missing.
        setSavedId(p.session.id)
        setPhase('saved')
      } else onSaved(p.session.id)
    } catch (e) {
      setSaveError(cleanErr(e))
      setPhase('save-failed')
    }
  }

  // Hotkeys: F8 marker, F9 stop.
  useEffect(() => {
    return window.senti.onHotkey((k) => {
      if (phaseRef.current !== 'play' || !recording.current) return
      if (k === 'stop') void finish()
      else {
        const t = Math.round(((Date.now() - recording.current.startedAtMs) / 1000) * 10) / 10
        markers.current.push(t)
        setMarkerCount(markers.current.length)
      }
    })
  }, [finish])

  function cancelAll(): void {
    onCancel()
  }

  // The same report model as the finished report, run on what has arrived so far. Flinch marks therefore
  // use exactly the rule in felt.ts.
  const live = useMemo(() => {
    if (phase !== 'play') return null
    const partial = {
      id: 'live',
      name: draft.name,
      createdAt: '',
      plannedSec: draft.plannedSec,
      intended: draft.intended,
      beats: draft.beats,
      markers: [],
      baseline: baseSeen.current,
      samples: playSeen.current,
      playStartedAtMs: 0,
      playedSec: 0,
      recording: null,
      sensing: { restarts: 0, signals: [] },
      consent: { acceptedAt: '' }
    } as Session
    try {
      return computeReport(partial)
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tick, draft])

  // ---------- screens ----------

  if (phase === 'consent') {
    const items: Array<[typeof Camera, string]> = [
      [Camera, 'Senti uses your webcam to notice reactions (head movement, talking, facial expression) while you play.'],
      [MonitorPlay, 'It records your screen while you play, never your face. Camera video is never saved or uploaded.'],
      [
        HardDrive,
        'Readings stay on this computer. Presage’s SDK checks the API key online and, per Presage’s documentation, may send short number summaries (never video) to Presage.'
      ],
      [User, 'Only you should be in view.'],
      [Keyboard, 'Stop any time with F9 or the Stop button.'],
      [Info, 'Senti is not a medical device.']
    ]
    return (
      <Shell width="mid">
        <div className="stack-lg enter">
          <div className="stack">
            <h1>Before you play</h1>
            <p className="t2">This is for the person who will play. Please read it.</p>
          </div>
          <div className="card">
            <ul className="consent-list">
              {items.map(([Icon, text], i) => (
                <li key={i}>
                  <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="row">
            <button
              className="btn primary big"
              onClick={() => {
                consentAt.current = new Date().toISOString()
                setPhase('camera')
              }}
            >
              I agree, start camera
            </button>
            <button className="btn ghost" onClick={cancelAll}>
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'camera') {
    const state = status?.state
    const hint = status?.hint ?? ''
    let message = ''
    if (startError) message = startError
    else if (starting || !status || state === 'starting') message = 'Starting the camera…'
    else if (state === 'busy') message = status.message || 'Your camera is in use by another app.'
    else if (state === 'error') message = status.message || 'The camera reader hit a problem.'
    else if (state === 'recovering') message = 'Reconnecting the camera reader…'
    else if (!status.ready && !status.hint) message = 'Finding your face…'
    const problem = !!startError || state === 'busy' || state === 'error'
    const running = state === 'running' && !problem
    // Each item ticks only from what the SDK really reported.
    const noFace = /no face/i.test(hint)
    const checks: Array<[string, boolean]> = [
      ['Camera on', running],
      ['Face found', running && !noFace],
      ['Framing and light OK', running && hint === ''],
      ['Holding steady', running && !!status?.ready]
    ]
    const ready = !!status?.ready && !problem
    return (
      <Shell>
        <div className="stack-lg enter">
          <h1>Camera check</h1>
          <div className="check-grid">
            <div className="viewport">
              <canvas ref={canvasRef} width={320} height={240} aria-label="Your camera preview" />
              <svg className="guide" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                <path fillRule="evenodd" fill="rgba(7,8,12,0.4)" d="M0 0H400V300H0Z M200 40 a82 108 0 1 0 0.01 0Z" />
                <ellipse cx={200} cy={148} rx={82} ry={108} fill="none" stroke={ready ? 'var(--pos)' : 'var(--text)'} strokeOpacity={ready ? 0.9 : 0.5} strokeWidth={2} strokeDasharray={ready ? undefined : '6 6'} />
                <path d="M12 36V12H36 M364 12H388V36 M388 264V288H364 M36 288H12V264" fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="stack-lg">
              <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'nowrap' }}>
                <Ring on={ready} />
                <div aria-live="polite" style={{ flex: 1 }}>
                  {status?.hint && !problem && <div className="hint-big">{status.hint}</div>}
                  {message && (
                    <div className={`hint-big${problem ? ' error' : ' t2'}`} role={problem ? 'alert' : undefined}>
                      {message}
                    </div>
                  )}
                  {ready && <div className="hint-big ok">Looking good. You can start.</div>}
                </div>
              </div>
              <ul className="checklist" aria-label="Camera check">
                {checks.map(([label, on]) => (
                  <li key={label} className={on ? 'on' : ''}>
                    <span className="tick" aria-hidden="true">
                      {on && <Check size={12} strokeWidth={2.5} />}
                    </span>
                    <span>{label}</span>
                    <span className="sr-only">{on ? 'done' : 'not yet'}</span>
                  </li>
                ))}
              </ul>
              <div className="stack">
                <p className="t2">{TIPS}</p>
                <p className="muted small">This preview stays on screen only. It is not saved.</p>
              </div>
            </div>
          </div>
          <div className="row">
            <button className="btn primary big" disabled={!status?.ready || problem} onClick={() => void beginBaseline()}>
              Start baseline
            </button>
            {problem && (
              <button className="btn big" disabled={starting} onClick={() => void startCamera()}>
                Retry
              </button>
            )}
            <button className="btn ghost" onClick={cancelAll}>
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'baseline') {
    const problem = baselineProblem
    return (
      <Shell width="mid">
        <div className="stack-lg enter">
          <div className="row spread" style={{ alignItems: 'flex-end' }}>
            <div className="stack">
              <h1>Baseline</h1>
              <p style={{ fontSize: 18 }}>Sit still and look at the screen. Senti is learning your normal</p>
            </div>
            <div className="countdown" aria-label="Time left">
              {fmt(baselineLeft)}
            </div>
          </div>
          <div className="stack">
            <div className="row spread">
              <span className="t2 small">Head motion, live</span>
              <span className="mono muted small">last {BASELINE_SEC} s</span>
            </div>
            <div className="monitor">
              <LiveTrace points={trace} windowSec={BASELINE_SEC} live={!problem} height={128} max={2} label="Live head motion from the camera. Gaps mean no reading." />
            </div>
          </div>
          <p className={problem ? 'error' : 'muted'} aria-live="polite">
            {problem ? status?.message || 'The camera reader hit a problem.' : sample?.face ? 'Face found.' : 'Looking for your face…'}
          </p>
          <div className="row">
            {problem && (
              <button className="btn big" onClick={backToCheck}>
                Retry
              </button>
            )}
            <button className="btn ghost" onClick={cancelAll}>
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'ready') {
    const sState = status?.state
    const readyProblem = sState === 'error' || sState === 'busy'
    const sensorOk = sState === 'running'
    const lowFace = baseFace < MIN_BASELINE_FACE_SEC
    return (
      <Shell width="narrow">
        <div className="stack-lg enter">
          <h1>Ready to play</h1>
          <p style={{ fontSize: 17 }}>
            {hotkeysOk ? (
              <>
                Senti will record your screen. After you press start, switch to your game. Press <span className="keycap">F8</span> to drop a marker and{' '}
                <span className="keycap">F9</span> to stop.
              </>
            ) : (
              <>Senti will record your screen. Keyboard shortcuts are not available, so Senti stays on screen. Use its Stop button to finish.</>
            )}
          </p>
          {lowFace && (
            <div className="stack">
              <p className="notice" role="alert">
                Senti barely saw your face during the baseline. Redo it for a better report.
              </p>
              <div>
                <button className="btn" disabled={starting || !sensorOk} onClick={() => void beginBaseline()}>
                  Redo baseline
                </button>
              </div>
            </div>
          )}
          {readyProblem && (
            <p className="error" role="alert">
              {status?.message || 'The camera reader hit a problem.'}
            </p>
          )}
          {!readyProblem && !sensorOk && !starting && (
            <p className="t2" aria-live="polite">
              Waiting for the camera reader…
            </p>
          )}
          {starting && <p className="t2" aria-live="polite">Starting the recorder…</p>}
          {startError && !starting && <p className="error" role="alert">{startError}</p>}
          <div className="row">
            <button className="btn primary big" disabled={starting || !sensorOk} onClick={() => void beginPlay()}>
              {starting ? 'Starting the recorder…' : startError ? 'Retry' : 'Start playtest'}
            </button>
            {readyProblem && (
              <button className="btn big" disabled={starting} onClick={backToCheck}>
                Retry
              </button>
            )}
            <button className="btn ghost" onClick={cancelAll}>
              Cancel
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'play') {
    const level = Math.round(levelAt(draft.intended, elapsed))
    const sensingProblem = !!status && (status.state === 'error' || status.state === 'busy')
    const flinches = live ? live.moments.filter((m) => m.kind === 'startle').length : 0
    const p95 = live?.baseline.headSpeedP95 ?? 0
    // Same flinch line as felt.ts: 2 x the baseline 95th percentile, never below 1.0 face-widths per second.
    const thr = Math.max(1, 2 * p95)
    const total = Math.max(draft.plannedSec, elapsed)
    return (
      <Shell
        width="mid"
        right={
          <span className="row mono t2 small" style={{ gap: 8 }}>
            <span className="live-dot" aria-hidden="true" />
            Recording
          </span>
        }
      >
        <div className="stack enter">
          <div className="row spread" style={{ alignItems: 'center' }}>
            <div className="row" style={{ gap: 24, alignItems: 'baseline' }}>
              <h1>Playtest running</h1>
              <div className="mono" style={{ fontSize: 28 }}>
                {fmt(elapsed)} <span className="t2" style={{ fontSize: 16 }}>of {fmt(draft.plannedSec)}</span>
              </div>
            </div>
            <div className="row" style={{ gap: 16 }}>
              {hotkeysOk && (
                <span className="muted small">
                  <span className="keycap">F8</span> drops a marker
                </span>
              )}
              <button className="btn primary big" onClick={() => void finish()}>
                {hotkeysOk ? 'Stop (F9)' : 'Stop'}
              </button>
            </div>
          </div>
          <div className="monitor" style={{ padding: '8px 12px 4px' }}>
            <Timeline
              variant="live"
              draw={false}
              intended={draft.intended}
              felt={live?.felt ?? []}
              moments={live?.moments.filter((m) => m.kind === 'startle') ?? []}
              total={total}
              now={elapsed}
              label="Your intended curve, with the player's felt reaction building as readings arrive"
            />
          </div>
          <div className="stack">
            <div className="row spread">
              <span className="t2 small">Head motion, last minute</span>
            </div>
            <div className="monitor">
              <LiveTrace points={trace} windowSec={60} live={!sensingProblem} height={96} max={3} threshold={thr} thresholdLabel="Flinch line" label="Live head motion. Gaps mean no reading." />
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="k">Flinches</div>
              <div className="v key">{flinches}</div>
            </div>
            <div className="stat">
              <div className="k">Intended now</div>
              <div className="v">{level}</div>
            </div>
            <div className="stat">
              <div className="k">{hotkeysOk ? 'Markers (F8)' : 'Markers'}</div>
              <div className="v">{markerCount}</div>
            </div>
            <div className="stat">
              <div className="k">Face found</div>
              <div className="v">{sample ? (sample.face ? 'Yes' : 'No') : 'Waiting'}</div>
            </div>
            <div className="stat">
              <div className="k">Talking</div>
              <div className="v">{sample ? ((sample.talking ?? 0) > 0.3 ? 'Yes' : 'No') : 'Waiting'}</div>
            </div>
            <div className="stat">
              <div className="k">Camera reader</div>
              <div className={`v${sensingProblem ? ' error' : ''}`} style={{ fontSize: 16, lineHeight: '28px' }}>
                {status ? status.state : 'Waiting'}
              </div>
            </div>
            <div className="stat">
              <div className="k">Restarts</div>
              <div className="v">{status?.restarts ?? 0}</div>
            </div>
          </div>
          {sensingProblem && status?.message && <p className="error">{status.message}</p>}
          {notice && <p className="notice">{notice}</p>}
          <div className="sr-only" aria-live="polite">
            {sensingProblem ? `Camera reader ${status?.state}. ${status?.message ?? ''}` : ''} {plural(markerCount, 'marker', 'markers')}. {plural(flinches, 'flinch', 'flinches')}.
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'saving') {
    return (
      <Shell width="narrow">
        <div className="stack-lg enter" aria-live="polite">
          <h1>Saving…</h1>
          <p className="t2">Writing the recording and readings to this computer. Please wait.</p>
          {notice && <p className="notice">{notice}</p>}
        </div>
      </Shell>
    )
  }

  if (phase === 'saved') {
    return (
      <Shell width="narrow">
        <div className="stack-lg enter">
          <h1>Saved</h1>
          <p className="notice" role="alert">{notice}</p>
          <div>
            <button className="btn primary big" onClick={() => onSaved(savedId)}>
              Open report
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // save-failed
  return (
    <Shell width="narrow">
      <div className="stack-lg enter">
        <h1>Could not save</h1>
        <p className="error" role="alert">{saveError}</p>
        <p>The playtest is still in memory. Try again, or discard it.</p>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>
            Try again
          </button>
          <button
            className="btn danger"
            onClick={() => {
              pending.current = null
              onCancel()
            }}
          >
            Discard playtest
          </button>
        </div>
      </div>
    </Shell>
  )
}
