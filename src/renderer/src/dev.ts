// Dev-only helpers, reachable only through a "#dev-..." URL hash set by main under SENTI_* env flags.
import { newSessionId, primeDuration } from './util'
import { startRecording } from './useRecorder'
import type { Session } from '../../shared/session'

const log = (o: unknown): void => console.log('SENTI_SEEKTEST ' + JSON.stringify(o))

/** Records a synthetic canvas video, saves it through the real IPC, then seeks it via senti-media://. */
export async function seekTest(): Promise<void> {
  const res: Record<string, unknown> = {}
  const id = newSessionId()
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')!
    let n = 0
    const draw = setInterval(() => {
      ctx.fillStyle = `hsl(${(n * 7) % 360},70%,50%)`
      ctx.fillRect(0, 0, 320, 240)
      ctx.fillStyle = '#fff'
      ctx.font = '40px sans-serif'
      ctx.fillText(String(n++), 20, 120)
    }, 33)
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.start(1000)
    await new Promise((r) => setTimeout(r, 5000))
    await new Promise<void>((r) => {
      rec.onstop = () => r()
      rec.stop()
    })
    clearInterval(draw)
    const blob = new Blob(chunks, { type: 'video/webm' })
    res.bytes = blob.size
    const session: Session = {
      id,
      name: 'Seek test',
      createdAt: new Date().toISOString(),
      plannedSec: 5,
      intended: [{ t: 0, level: 10 }, { t: 5, level: 10 }],
      beats: [],
      markers: [],
      baseline: [],
      samples: [],
      playStartedAtMs: Date.now(),
      playedSec: 5,
      recording: null,
      sensing: { restarts: 0, signals: [] },
      consent: { acceptedAt: new Date().toISOString() }
    }
    await window.senti.sessionsSave(session, await blob.arrayBuffer())
    const got = await window.senti.sessionsGet(id)
    res.savedBytes = got?.recording?.bytes
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.src = window.senti.sessionVideoUrl(id)
    await new Promise<void>((ok, bad) => {
      v.onloadedmetadata = () => ok()
      v.onerror = () => bad(new Error('video error ' + v.error?.code + ' ' + v.error?.message))
    })
    res.durationBefore = String(v.duration)
    await primeDuration(v)
    res.durationAfter = v.duration
    const seekTo = async (t: number): Promise<number> => {
      await new Promise<void>((ok) => {
        v.onseeked = () => ok()
        v.currentTime = t
        setTimeout(ok, 4000)
      })
      return v.currentTime
    }
    res.seek3 = await seekTo(3)
    res.seek1 = await seekTo(1)
    res.seek4 = await seekTo(4)
    const near = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 0.6
    res.pass = near(res.seek3, 3) && near(res.seek1, 1) && near(res.seek4, 4) && Number.isFinite(v.duration)
  } catch (e) {
    res.pass = false
    res.error = (e as Error).message
  }
  await window.senti.sessionsDelete(id).catch(() => undefined)
  log(res)
}

/** SENTI_RECORD_SELFTEST: the real startRecording() path for 10 s while main has the camera reader running. */
export async function recordTest(): Promise<void> {
  const res: Record<string, unknown> = {}
  try {
    const t0 = Date.now()
    const rec = await startRecording(() => undefined)
    res.startedWithinMs = Date.now() - t0
    res.timing = rec.timing
    await new Promise((r) => setTimeout(r, 10_000))
    res.chunks = rec.chunkCount()
    const blob = await rec.stop()
    res.bytes = blob.size
    res.pass = (res.chunks as number) >= 8
  } catch (e) {
    res.pass = false
    res.error = (e as Error).message
  }
  console.log('SENTI_RECORD_SELFTEST ' + JSON.stringify(res))
}
