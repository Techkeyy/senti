import { useEffect, useRef, useState } from 'react'
import type { CaptureSource } from '../../shared/ipc'
import { useRecorder } from './useRecorder'
import SensorTest from './SensorTest'
import type { SensorConfig } from '../../shared/ipc'

const AUTOTEST_MS = 10_000

function RecorderSpike({ onSensorTest }: { onSensorTest: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const frameCount = useRef(0)
  const [frames, setFrames] = useState(0)
  const [readyState, setReadyState] = useState('none')
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [error, setError] = useState('')
  const { recording, start, stop } = useRecorder()

  async function startCamera(): Promise<void> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true })
    } catch (e) {
      throw new Error(`getUserMedia (camera) failed: ${(e as Error).name}: ${(e as Error).message}`)
    }
    trackRef.current = stream.getVideoTracks()[0]
    const video = videoRef.current!
    video.srcObject = stream
    await video.play()
    const tick = (): void => {
      frameCount.current++
      video.requestVideoFrameCallback(tick)
    }
    video.requestVideoFrameCallback(tick)
  }

  async function runAutotest(list: CaptureSource[]): Promise<void> {
    const screen = list.find((s) => s.kind === 'screen')
    if (!screen) throw new Error('no screen source found')
    const framesBefore = frameCount.current
    const t0 = performance.now()
    await start(screen.id)
    await new Promise((r) => setTimeout(r, AUTOTEST_MS))
    const framesDuring = frameCount.current - framesBefore
    const cameraReadyState = trackRef.current?.readyState ?? 'none'
    const rec = await stop()
    await window.senti.spikeResult({
      ok: true,
      source: { id: screen.id, name: screen.name },
      cameraFramesDuringRecording: framesDuring,
      cameraReadyStateAtEnd: cameraReadyState,
      recordingPath: rec.path,
      fileSizeBytes: rec.bytes,
      recordingDurationMs: Math.round(rec.durationMs),
      wallMs: Math.round(performance.now() - t0)
    })
  }

  useEffect(() => {
    const id = setInterval(() => {
      setFrames(frameCount.current)
      setReadyState(trackRef.current?.readyState ?? 'none')
    }, 250)
    ;(async () => {
      try {
        const cfg = await window.senti.spikeConfig()
        await startCamera()
        const list = await window.senti.listSources()
        setSources(list)
        setSourceId(list[0]?.id ?? '')
        if (cfg.autotest) await runAutotest(list)
      } catch (e) {
        const err = e as Error
        setError(`${err.name}: ${err.message}`)
        await window.senti.spikeResult({ ok: false, error: `${err.name}: ${err.message}` })
      }
    })()
    return () => {
      clearInterval(id)
      trackRef.current?.stop()
    }
  }, [])

  async function onStop(): Promise<void> {
    const rec = await stop()
    setSavedPath(rec.path)
  }

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1>Senti recorder spike</h1>
      <p>
        <button onClick={onSensorTest}>Sensor Test</button>
      </p>
      <video ref={videoRef} muted width={320} height={240} />
      <p>
        Camera track: {readyState} | camera frames: {frames}
      </p>
      <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            [{s.kind}] {s.name}
          </option>
        ))}
      </select>{' '}
      <button disabled={recording || !sourceId} onClick={() => start(sourceId).catch((e) => setError(String(e)))}>
        Start
      </button>{' '}
      <button disabled={!recording} onClick={() => onStop().catch((e) => setError(String(e)))}>
        Stop
      </button>
      {recording && <p>Recording...</p>}
      {savedPath && <p>Saved: {savedPath}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}

export default function App() {
  const [config, setConfig] = useState<SensorConfig | null>(null)
  const [view, setView] = useState<'recorder' | 'sensor'>('recorder')

  useEffect(() => {
    window.senti.sensorConfig().then((c) => {
      setConfig(c)
      if (c.plan) setView('sensor')
    })
  }, [])

  if (!config) return null
  if (view === 'sensor') return <SensorTest config={config} onBack={() => setView('recorder')} />
  return <RecorderSpike onSensorTest={() => setView('sensor')} />
}
