import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Session } from '../../shared/session'
import { computeReport } from '../../shared/felt'
import { cleanErr } from './screens1'
import { FlinchIcon } from './FlinchMark'
import { Shell } from './Shell'
import Timeline from './Timeline'
import { fmt, fmtDate, plural, primeDuration, totalSec } from './util'

/** The range is already shown in the left column, so drop it from the front of the sentence when it repeats. */
function sentence(text: string, start: number, end: number): string {
  const prefix = `${fmt(start)} to ${fmt(end)}: `
  if (!text.startsWith(prefix)) return text
  const rest = text.slice(prefix.length)
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

export default function Report({ id, onBack }: { id: string; onBack: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState('')
  const [now, setNow] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    window.senti.sessionsGet(id).then(
      (s) => setSession(s),
      (e) => {
        setError(cleanErr(e))
        setSession(null)
      }
    )
  }, [id])

  const report = useMemo(() => (session ? computeReport(session) : null), [session])

  // Playhead follows the video while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let raf = 0
    const tick = (): void => {
      setNow(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    const start = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const stop = (): void => {
      cancelAnimationFrame(raf)
      setNow(v.currentTime)
    }
    v.addEventListener('play', start)
    v.addEventListener('pause', stop)
    v.addEventListener('seeked', stop)
    v.addEventListener('ended', stop)
    return () => {
      cancelAnimationFrame(raf)
      v.removeEventListener('play', start)
      v.removeEventListener('pause', stop)
      v.removeEventListener('seeked', stop)
      v.removeEventListener('ended', stop)
    }
  }, [session])

  const back = (
    <button className="btn ghost" onClick={onBack}>
      <ArrowLeft size={16} aria-hidden="true" />
      Back to playtests
    </button>
  )

  if (session === undefined) {
    return (
      <Shell right={back}>
        <p className="muted">Loading playtest…</p>
      </Shell>
    )
  }
  if (!session || !report) {
    return (
      <Shell right={back}>
        <div className="stack">
          <h1>Report</h1>
          <p className="error" role="alert">{error || 'This playtest could not be found.'}</p>
        </div>
      </Shell>
    )
  }

  const total = totalSec(session, report)

  function seek(t: number): void {
    const v = videoRef.current
    if (!v) return
    const max = Number.isFinite(v.duration) ? v.duration : session!.playedSec
    v.currentTime = Math.max(0, Math.min(t, max || t))
    setNow(v.currentTime)
  }

  const noFelt = report.felt.length === 0
  const flinches = report.moments.filter((m) => m.kind === 'startle').length
  const voices = report.moments.filter((m) => m.kind === 'voice').length
  const lookSec = report.moments.filter((m) => m.kind === 'lookaway').reduce((a, m) => a + m.durationSec, 0)
  const hasRecording = !!session.recording

  return (
    <Shell right={back}>
      <div className="stack-lg">
        <div className="enter">
          <h1>{session.name}</h1>
          <div className="mono muted small" style={{ marginTop: 6 }}>
            {fmtDate(session.createdAt)} &middot; {fmt(session.playedSec)} played of {fmt(session.plannedSec)} planned
          </div>
        </div>

        {hasRecording ? (
          <div className="stack">
            <div className="video-frame enter d1">
              <video
                ref={videoRef}
                src={window.senti.sessionVideoUrl(session.id)}
                controls
                preload="metadata"
                onLoadedMetadata={(e) => void primeDuration(e.currentTarget)}
                onError={(e) => {
                  // Seen once right after saving (the window restoring, the camera reader shutting down) but not
                  // reproducible when reopening the report. Log the exact cause, retry once, then tell the truth.
                  const v = e.currentTarget
                  console.log(`SENTI_VIDEO_ERROR code=${v.error?.code} msg=${v.error?.message ?? ''} retried=${v.dataset.retried ?? 'no'}`)
                  if (!v.dataset.retried) {
                    v.dataset.retried = 'yes'
                    setTimeout(() => {
                      v.src = `${window.senti.sessionVideoUrl(session.id)}?r=${Date.now()}`
                      v.load()
                    }, 1500)
                    return
                  }
                  setVideoError('The recording could not be played.')
                }}
              />
            </div>
            {videoError && <p className="error" role="alert">{videoError}</p>}
          </div>
        ) : (
          <p className="notice">No recording was saved for this playtest.</p>
        )}

        <div className="stack enter d2">
          {!noFelt && (
            <p className="summary" aria-live="polite">
              <span className="key">{plural(report.mismatches.length, 'mismatch', 'mismatches')}</span>
              <span className="sep">&middot;</span>
              {plural(flinches, 'flinch', 'flinches')}
              {lookSec > 0 && (
                <>
                  <span className="sep">&middot;</span>
                  player looked away for <span className="mono">{fmt(lookSec)}</span>
                </>
              )}
            </p>
          )}
          <div className="chart-card">
            <Timeline
              variant="big"
              intended={session.intended}
              felt={report.felt}
              total={total}
              beats={session.beats}
              markers={session.markers}
              moments={report.moments}
              mismatches={report.mismatches}
              now={hasRecording ? now : undefined}
              onSeek={hasRecording ? seek : undefined}
              label={`Intended and felt tension over time. ${hasRecording ? 'Click to seek the video.' : ''}`}
            />
            <div className="legend">
              <span>
                <i className="swatch dashed" /> Intended
              </span>
              {!noFelt && (
                <span>
                  <i className="swatch ember" /> Felt
                </span>
              )}
              {flinches > 0 && (
                <span>
                  <FlinchIcon /> Flinch
                </span>
              )}
              {report.mismatches.length > 0 && (
                <span>
                  <i className="swatch wash" /> Mismatch
                </span>
              )}
              {lookSec > 0 && (
                <span>
                  <i className="swatch band" /> Looked away
                </span>
              )}
              {voices > 0 && (
                <span>
                  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
                    <circle cx={7} cy={7} r={4} fill="none" stroke="var(--text2)" strokeWidth={1.5} />
                  </svg>{' '}
                  Voice reaction
                </span>
              )}
              {session.beats.length > 0 && (
                <span>
                  <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
                    <line x1={3} x2={3} y1={1} y2={13} stroke="var(--text)" strokeWidth={1.5} />
                  </svg>{' '}
                  Beat
                </span>
              )}
              {session.markers.length > 0 && (
                <span>
                  <i className="swatch tick" /> Your marker (F8)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="stack enter d3">
          <h2>Where the plan and the player disagreed</h2>
          {noFelt ? (
            <p className="mm-empty">No reaction data was captured for this playtest.</p>
          ) : report.mismatches.length === 0 ? (
            <p className="mm-empty">No mismatches found: reactions followed your plan.</p>
          ) : (
            <div className="mm-list">
              {report.mismatches.map((m, i) => (
                <button key={i} className="mm-row" onClick={() => seek(m.start)} disabled={!hasRecording} style={{ cursor: hasRecording ? 'pointer' : 'default' }}>
                  <span className="when">
                    {fmt(m.start)} to {fmt(m.end)}
                  </span>
                  <span>{sentence(m.text, m.start, m.end)}</span>
                  <span />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
