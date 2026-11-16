import { useCallback, useRef, useState } from 'react'

export interface RecordingResult {
  path: string
  bytes: number
  durationMs: number
}

/** Records the source chosen via window.senti.selectSource(); main grants it in the display-media handler. */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)

  const start = useCallback(async (sourceId: string) => {
    await window.senti.selectSource(sourceId)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    } catch (e) {
      throw new Error(`getDisplayMedia (screen) failed: ${(e as Error).name}: ${(e as Error).message}`)
    }
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    chunksRef.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    startedAtRef.current = performance.now()
    rec.start(1000)
    recorderRef.current = rec
    setRecording(true)
  }, [])

  const stop = useCallback(async (): Promise<RecordingResult> => {
    const rec = recorderRef.current
    if (!rec) throw new Error('not recording')
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
    })
    rec.stop()
    await stopped
    const durationMs = performance.now() - startedAtRef.current
    rec.stream.getTracks().forEach((t) => t.stop())
    recorderRef.current = null
    setRecording(false)
    const blob = new Blob(chunksRef.current, { type: 'video/webm' })
    const saved = await window.senti.saveRecording(await blob.arrayBuffer())
    return { ...saved, durationMs }
  }, [])

  return { recording, start, stop }
}
