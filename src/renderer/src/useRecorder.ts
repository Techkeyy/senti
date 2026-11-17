export interface ActiveRecording {
  /** Epoch ms at the moment MediaRecorder actually started (onstart). */
  startedAtMs: number
  /** Non-empty data chunks received so far. */
  chunkCount(): number
  /** ms from the call: capture granted, MediaRecorder onstart, first data chunk. For diagnostics. */
  timing: { captureMs: number; onstartMs: number; firstDataMs: number }
  /** Stops recording, releases the capture and returns the webm. */
  stop(): Promise<Blob>
}

/** Light settings measured to stay healthy while the camera reader runs on a 2-core laptop. */
// Kept light on purpose: on a 2-core laptop, Presage face processing + playback + recording must share the CPU (measured 17 Nov).
const CAPTURE = { frameRate: 5, width: 640, height: 360 }
const FIRST_DATA_TIMEOUT_MS = 30_000

export class RecorderStartError extends Error {}

export const RECORDER_START_FAILED =
  'The screen recorder could not start. Close other screen recorders or heavy apps and try again.'

/**
 * Records the whole primary screen (main grants it in the display-media handler, no picker).
 * Resolves only when the first non-empty data chunk has arrived, within 30 s (cold starts on slow laptops measured ~11 to 15 s). startedAtMs comes from onstart.
 * onEnded fires if the capture ends by itself.
 */
export async function startRecording(onEnded: () => void): Promise<ActiveRecording> {
  const t0 = Date.now()
  let captureMs = 0
  let onstartMs = 0
  let firstDataMs = 0
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: CAPTURE, audio: false })
  } catch {
    throw new RecorderStartError(RECORDER_START_FAILED)
  }
  captureMs = Date.now() - t0
  const release = (): void => stream.getTracks().forEach((t) => t.stop())
  // vp8 is lighter on the CPU than vp9, which matters while the camera reader is running.
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500_000 })
  } catch {
    release()
    throw new RecorderStartError(RECORDER_START_FAILED)
  }
  const chunks: Blob[] = []
  let startedAtMs = 0
  const firstData = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* already stopped */
      }
      release()
      reject(new RecorderStartError(RECORDER_START_FAILED))
    }, FIRST_DATA_TIMEOUT_MS)
    rec.onstart = () => {
      startedAtMs = Date.now()
      onstartMs = startedAtMs - t0
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data)
        if (chunks.length === 1) {
          clearTimeout(timer)
          firstDataMs = Date.now() - t0
          resolve()
        }
      }
    }
    rec.onerror = () => {
      clearTimeout(timer)
      release()
      reject(new RecorderStartError(RECORDER_START_FAILED))
    }
    rec.start(1000)
  })
  await firstData
  if (!startedAtMs) startedAtMs = Date.now() // onstart is not guaranteed to be seen before data; fall back to now
  stream.getVideoTracks()[0]?.addEventListener('ended', onEnded)
  return {
    startedAtMs,
    chunkCount: () => chunks.length,
    timing: { captureMs, onstartMs, firstDataMs },
    stop: () =>
      new Promise<Blob>((resolve) => {
        const finish = (): void => {
          release()
          resolve(new Blob(chunks, { type: 'video/webm' }))
        }
        if (rec.state === 'inactive') return finish()
        rec.onstop = finish
        rec.stop()
      })
  }
}
