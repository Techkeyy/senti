import { useCallback, useEffect, useRef, useState } from 'react'
import type { SecondSample, SensingStatus, Session } from '../../shared/session'
import { startRecording, type ActiveRecording } from './useRecorder'
import { cleanErr, type Draft } from './screens1'
import { fmt, levelAt, newSessionId } from './util'

type Phase = 'consent' | 'camera' | 'baseline' | 'ready' | 'play' | 'saving' | 'save-failed'
const BASELINE_SEC = 30

const TIPS = 'Face the screen, light in front of you, shoulders in view, only you in the picture.'

interface Props {
  draft: Draft
  initialPhase?: Phase
  onCancel: () => void
  onSaved: (id: string) => void
}

export default function RunFlow({ draft, initialPhase = 'consent', onCancel, onSaved }: Props) {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [status, setStatus] = useState<SensingStatus | null>(null)
  const [sample, setSample] = useState<SecondSample | null>(null)
  const [startError, setStartError] = useState('')
  const [starting, setStarting] = useState(false)
  const [baselineLeft, setBaselineLeft] = useState(BASELINE_SEC)
  const [elapsed, setElapsed] = useState(0)
  const [markerCount, setMarkerCount] = useState(0)
  const [notice, setNotice] = useState('')
  const [saveError, setSaveError] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const consentAt = useRef('')
  const sensingOn = useRef(false)
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase
  const recording = useRef<ActiveRecording | null>(null)
  const markers = useRef<number[]>([])
  const stopping = useRef(false)
  const pending = useRef<{ session: Session; blob: Blob | null } | null>(null)

  // Push subscriptions live for the whole flow.
  useEffect(() => {
    const offEvent = window.senti.onSensingEvent((e) => {
      setStatus(e.status)
      if (e.sample) setSample(e.sample)
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
  }, [])

  // Release everything if the flow is left in any way.
  useEffect(() => {
    return () => {
      if (sensingOn.current) {
        sensingOn.current = false
        void window.senti.sensingStop().catch(() => undefined)
      }
      void window.senti.hotkeysEnable(false).catch(() => undefined)
      if (recording.current) void recording.current.stop().catch(() => undefined)
    }
  }, [])

  const startCamera = useCallback(async () => {
    setStarting(true)
    setStartError('')
    setStatus(null)
    try {
      if (sensingOn.current) {
        sensingOn.current = false
        await window.senti.sensingStop().catch(() => undefined)
      }
      await window.senti.sensingStart()
      sensingOn.current = true
      await window.senti.sensingPhase('check')
    } catch (e) {
      setStartError(cleanErr(e))
    }
    setStarting(false)
  }, [])

  // Camera check begins as soon as that phase is entered.
  useEffect(() => {
    if (phase === 'camera' && !sensingOn.current) void startCamera()
  }, [phase, startCamera])

  // Baseline countdown.
  useEffect(() => {
    if (phase !== 'baseline') return
    const t0 = Date.now()
    const id = setInterval(() => {
      const left = Math.max(0, BASELINE_SEC - Math.floor((Date.now() - t0) / 1000))
      setBaselineLeft(left)
      if (left === 0) {
        clearInterval(id)
        setPhase('ready')
      }
    }, 250)
    return () => clearInterval(id)
  }, [phase])

  // Play clock.
  useEffect(() => {
    if (phase !== 'play') return
    const id = setInterval(() => {
      if (recording.current) setElapsed((Date.now() - recording.current.startedAtMs) / 1000)
    }, 250)
    return () => clearInterval(id)
  }, [phase])

  async function beginBaseline(): Promise<void> {
    try {
      await window.senti.sensingPhase('baseline')
      setBaselineLeft(BASELINE_SEC)
      setPhase('baseline')
    } catch (e) {
      setStartError(cleanErr(e))
    }
  }

  async function beginPlay(): Promise<void> {
    setStarting(true)
    setStartError('')
    stopping.current = false
    try {
      const rec = await startRecording(draft.sourceId, () => void finish())
      recording.current = rec
      markers.current = []
      setMarkerCount(0)
      setElapsed(0)
      await window.senti.sensingPhase('play', rec.startedAtMs)
      try {
        await window.senti.hotkeysEnable(true)
        setNotice('')
      } catch (e) {
        setNotice(cleanErr(e))
      }
      setPhase('play')
    } catch (e) {
      if (recording.current) {
        await recording.current.stop().catch(() => undefined)
        recording.current = null
      }
      setStartError(cleanErr(e))
    }
    setStarting(false)
  }

  const finish = useCallback(async (): Promise<void> => {
    const rec = recording.current
    if (!rec || stopping.current || phaseRef.current !== 'play') return
    stopping.current = true
    setPhase('saving')
    setSaveError('')
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
    const session: Session = {
      id: newSessionId(),
      name: draft.name,
      createdAt: new Date(rec.startedAtMs).toISOString(),
      plannedSec: draft.plannedSec,
      intended: draft.intended,
      beats: draft.beats,
      markers: markers.current.map((t) => ({ t })),
      baseline: result.baseline,
      samples: result.samples,
      playStartedAtMs: rec.startedAtMs,
      playedSec: Math.round(((stoppedAt - rec.startedAtMs) / 1000) * 10) / 10,
      recording: null,
      sensing: { restarts: result.restarts, signals: result.signals },
      consent: { acceptedAt: consentAt.current }
    }
    pending.current = { session, blob }
    if (sensingFailed) setNotice('The camera reader did not return its readings, so this playtest has no reaction data.')
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
      onSaved(p.session.id)
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

  // ---------- screens ----------

  if (phase === 'consent') {
    return (
      <div className="page narrow stack">
        <h1>Before you play</h1>
        <p className="dim">This is for the person who will play. Please read it.</p>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 20 }} className="stack">
            <li>Senti uses your webcam to notice reactions (head movement, talking, facial expression) while you play.</li>
            <li>It records the game window, not your face. Camera video is never saved or uploaded.</li>
            <li>
              Readings stay on this computer. Presage’s SDK checks the API key online and, per Presage’s documentation,
              may send short number summaries (never video) to Presage.
            </li>
            <li>Only you should be in view.</li>
            <li>Stop any time with F9 or the Stop button.</li>
            <li>Senti is not a medical device.</li>
          </ul>
        </div>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              consentAt.current = new Date().toISOString()
              setPhase('camera')
            }}
          >
            I agree, start camera
          </button>
          <button onClick={cancelAll}>Cancel</button>
        </div>
      </div>
    )
  }

  if (phase === 'camera') {
    const state = status?.state
    let message = ''
    if (startError) message = startError
    else if (starting || !status || state === 'starting') message = 'Starting the camera…'
    else if (state === 'busy') message = status.message || 'Your camera is in use by another app.'
    else if (state === 'error') message = status.message || 'The camera reader hit a problem.'
    else if (state === 'recovering') message = 'Reconnecting the camera reader…'
    else if (!status.ready && !status.hint) message = 'Finding your face…'
    const problem = !!startError || state === 'busy' || state === 'error'
    return (
      <div className="page stack">
        <h1>Camera check</h1>
        <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <canvas ref={canvasRef} className="camera" width={320} height={240} aria-label="Your camera preview" />
          <div style={{ flex: 1, minWidth: 260 }} className="stack">
            {status?.hint && !problem && <div className="hint">{status.hint}</div>}
            {message && <p className={problem ? 'error' : 'dim'} style={{ fontSize: 18 }}>{message}</p>}
            {status?.ready && !problem && <p className="ok" style={{ fontSize: 18 }}>Looking good. You can start.</p>}
            <p className="dim">{TIPS}</p>
            <p className="dim" style={{ fontSize: 'var(--fs-label)' }}>
              This preview stays on screen only. It is not saved.
            </p>
          </div>
        </div>
        <div className="row">
          <button className="primary" disabled={!status?.ready || problem} onClick={() => void beginBaseline()}>
            Start baseline
          </button>
          {problem && (
            <button disabled={starting} onClick={() => void startCamera()}>
              Retry
            </button>
          )}
          <button onClick={cancelAll}>Cancel</button>
        </div>
      </div>
    )
  }

  if (phase === 'baseline') {
    return (
      <div className="page narrow stack">
        <h1>Baseline</h1>
        <p style={{ fontSize: 18 }}>Sit still and look at the screen for 30 seconds. This learns your normal.</p>
        <div className="timer">{fmt(baselineLeft)}</div>
        <p className="dim">
          {status?.state === 'error' || status?.state === 'busy'
            ? status.message || 'The camera reader hit a problem.'
            : sample?.face
              ? 'Face found.'
              : 'Looking for your face…'}
        </p>
        <button onClick={cancelAll}>Cancel</button>
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <div className="page narrow stack">
        <h1>Ready to play</h1>
        <p>
          Senti will record “{draft.sourceName}”. After you press start, switch to your game. Press F8 to drop a marker
          and F9 to stop. Senti can be minimized.
        </p>
        {startError && <p className="error">{startError}</p>}
        <div className="row">
          <button className="primary big" disabled={starting} onClick={() => void beginPlay()}>
            {starting ? 'Starting…' : 'Start playtest'}
          </button>
          <button onClick={cancelAll}>Cancel</button>
        </div>
      </div>
    )
  }

  if (phase === 'play') {
    const level = Math.round(levelAt(draft.intended, elapsed))
    const motion = sample?.headSpeedMax ?? 0
    const sensingProblem = status && (status.state === 'error' || status.state === 'busy')
    return (
      <div className="page narrow stack">
        <div className="row spread">
          <h1>Recording</h1>
          <div className="timer">
            {fmt(elapsed)} <span className="dim" style={{ fontSize: 18 }}>of {fmt(draft.plannedSec)}</span>
          </div>
        </div>
        <div className="card kv">
          <div>Intended level now</div>
          <div>{level}</div>
          <div>Head motion</div>
          <div className="bar" aria-label="Head motion">
            <div style={{ width: `${Math.min(100, motion * 40)}%` }} />
          </div>
          <div>Talking</div>
          <div>
            <span className={`dot${sample && (sample.talking ?? 0) > 0.3 ? ' on' : ''}`} />
          </div>
          <div>Face found</div>
          <div>{sample ? (sample.face ? 'Yes' : 'No') : 'Waiting for data'}</div>
          <div>Camera reader</div>
          <div className={sensingProblem ? 'error' : ''}>
            {status ? status.state + (status.message && sensingProblem ? `: ${status.message}` : '') : 'Waiting'}
          </div>
          <div>Restarts</div>
          <div>{status?.restarts ?? 0}</div>
          <div>Markers</div>
          <div>{markerCount}</div>
        </div>
        {notice && <p className="notice">{notice}</p>}
        <div>
          <button className="primary big" onClick={() => void finish()}>
            Stop (F9)
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'saving') {
    return (
      <div className="page narrow stack">
        <h1>Saving…</h1>
        <p className="dim">Writing the recording and readings to this computer. Please wait.</p>
        {notice && <p className="notice">{notice}</p>}
      </div>
    )
  }

  // save-failed
  return (
    <div className="page narrow stack">
      <h1>Could not save</h1>
      <p className="error">{saveError}</p>
      <p>The playtest is still in memory. Try again, or discard it.</p>
      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Try again
        </button>
        <button
          className="danger"
          onClick={() => {
            pending.current = null
            onCancel()
          }}
        >
          Discard playtest
        </button>
      </div>
    </div>
  )
}
