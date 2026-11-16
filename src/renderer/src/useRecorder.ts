export interface ActiveRecording {
  /** Epoch ms at the moment MediaRecorder actually started. */
  startedAtMs: number
  /** Stops recording, releases the capture and returns the webm. */
  stop(): Promise<Blob>
}

/**
 * Records the source chosen with window.senti.selectSource(); main grants it in the display-media handler.
 * Resolves once MediaRecorder reports it started. onEnded fires if the captured window goes away.
 */
export async function startRecording(sourceId: string, onEnded: () => void): Promise<ActiveRecording> {
  await window.senti.selectSource(sourceId)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch (e) {
    throw new Error(`Could not capture that window (${(e as Error).name}). Pick it again and retry.`)
  }
  // vp8 is lighter on the CPU than vp9, which matters while the camera reader is running.
  const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const release = (): void => stream.getTracks().forEach((t) => t.stop())
  const startedAtMs = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      release()
      reject(new Error('The recorder did not start.'))
    }, 8000)
    rec.onstart = () => {
      clearTimeout(timer)
      resolve(Date.now())
    }
    rec.onerror = () => {
      clearTimeout(timer)
      release()
      reject(new Error('The recorder failed to start.'))
    }
    rec.start(1000)
  })
  stream.getVideoTracks()[0]?.addEventListener('ended', onEnded)
  return {
    startedAtMs,
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
