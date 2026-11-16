import { useEffect, useMemo, useRef, useState } from 'react'
import type { MomentKind, Session } from '../../shared/session'
import { computeReport } from '../../shared/felt'
import { cleanErr } from './screens1'
import { fmt, primeDuration, tickStep } from './util'

const W = 900
const H = 300
const M = { l: 44, r: 16, t: 28, b: 30 }
const PW = W - M.l - M.r
const PLOT_BOTTOM = H - M.b
const LANE_H = 26 // bottom lane for moments
const PH = H - M.t - M.b - LANE_H

const KIND_LABEL: Record<MomentKind, string> = { startle: 'Startle', voice: 'Voice reaction', lookaway: 'Looked away', freeze: 'Froze' }

function MomentShape({ kind, cx, cy }: { kind: MomentKind; cx: number; cy: number }) {
  const c = 'var(--felt)'
  if (kind === 'startle') return <polygon points={`${cx},${cy - 6} ${cx + 6},${cy + 5} ${cx - 6},${cy + 5}`} fill={c} />
  if (kind === 'voice') return <circle cx={cx} cy={cy} r={5} fill={c} />
  if (kind === 'lookaway') return <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={c} />
  return <polygon points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`} fill={c} />
}

export default function Report({ id, onBack }: { id: string; onBack: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState('')
  const [now, setNow] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  if (session === undefined) return <div className="page"><p className="dim">Loading playtest…</p></div>
  if (!session || !report) {
    return (
      <div className="page stack">
        <h1>Report</h1>
        <p className="error">{error || 'This playtest could not be found.'}</p>
        <button onClick={onBack}>Back to playtests</button>
      </div>
    )
  }

  const total = Math.max(session.plannedSec, session.playedSec, report.felt.length ? report.felt[report.felt.length - 1].t : 0, 1)
  const x = (t: number): number => M.l + (Math.min(total, Math.max(0, t)) / total) * PW
  const y = (level: number): number => M.t + PH - (level / 100) * PH

  function seek(t: number): void {
    const v = videoRef.current
    if (!v) return
    const max = Number.isFinite(v.duration) ? v.duration : session!.playedSec
    v.currentTime = Math.max(0, Math.min(t, max || t))
    setNow(v.currentTime)
  }

  function onChartClick(e: React.MouseEvent): void {
    const r = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    seek(((px - M.l) / PW) * total)
  }

  const step = tickStep(total)
  const ticks: number[] = []
  for (let t = 0; t <= total; t += step) ticks.push(t)

  const intendedPath = session.intended.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.level)}`).join(' ')
  const feltPath = report.felt.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.level)}`).join(' ')
  const noFelt = report.felt.length === 0
  const kindsPresent = Array.from(new Set(report.moments.map((m) => m.kind)))

  return (
    <div className="page stack">
      <div className="row spread">
        <div>
          <h1>{session.name}</h1>
          <div className="dim">
            {new Date(session.createdAt).toLocaleString()} · {fmt(session.playedSec)} played of {fmt(session.plannedSec)} planned
          </div>
        </div>
        <button onClick={onBack}>Back to playtests</button>
      </div>

      {session.recording ? (
        <>
          <video
            ref={videoRef}
            className="video"
            src={window.senti.sessionVideoUrl(session.id)}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => void primeDuration(e.currentTarget)}
            onError={() => setVideoError('The recording could not be played.')}
          />
          {videoError && <p className="error">{videoError}</p>}
        </>
      ) : (
        <p className="notice">No recording was saved for this playtest.</p>
      )}

      <div>
        <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${H}`} onClick={onChartClick} style={{ cursor: 'pointer' }} role="img" aria-label="Intended and felt tension over time. Click to seek the video.">
          {[0, 25, 50, 75, 100].map((l) => (
            <g key={l}>
              <line x1={M.l} x2={W - M.r} y1={y(l)} y2={y(l)} stroke="var(--border)" />
              <text x={M.l - 8} y={y(l) + 4} textAnchor="end">
                {l}
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle">
              {fmt(t)}
            </text>
          ))}
          {session.beats.map((b, i) => (
            <g key={`b${i}`}>
              <line x1={x(b.t)} x2={x(b.t)} y1={M.t} y2={PLOT_BOTTOM} stroke="var(--warn)" strokeDasharray="4 4" strokeWidth={1.5} />
              <text x={x(b.t) + 4} y={M.t - 8} style={{ fill: 'var(--warn)' }}>
                {b.label}
              </text>
            </g>
          ))}
          {session.markers.map((m, i) => (
            <line key={`m${i}`} x1={x(m.t)} x2={x(m.t)} y1={M.t} y2={M.t + 14} stroke="var(--ok)" strokeWidth={3} />
          ))}
          <path d={intendedPath} fill="none" stroke="var(--intended)" strokeWidth={2.5} strokeDasharray="8 5" />
          {!noFelt && <path d={feltPath} fill="none" stroke="var(--felt)" strokeWidth={3} strokeLinejoin="round" />}
          {report.moments.map((m, i) => (
            <MomentShape key={i} kind={m.kind} cx={x(m.t)} cy={PLOT_BOTTOM - LANE_H / 2 - 2} />
          ))}
          <line x1={x(now)} x2={x(now)} y1={M.t - 4} y2={PLOT_BOTTOM} stroke="var(--text)" strokeWidth={2} />
        </svg>
        <div className="legend">
          <span>
            <i className="swatch" style={{ borderColor: 'var(--intended)', borderTopStyle: 'dashed' }} /> Intended
          </span>
          <span>
            <i className="swatch" style={{ borderColor: 'var(--felt)' }} /> Felt
          </span>
          <span>
            <i className="swatch" style={{ borderColor: 'var(--warn)', borderTopStyle: 'dashed' }} /> Beat
          </span>
          <span>
            <i className="swatch" style={{ borderColor: 'var(--ok)' }} /> Your marker (F8)
          </span>
          {kindsPresent.map((k) => (
            <span key={k}>
              <svg width={14} height={14} viewBox="-7 -7 14 14">
                <MomentShape kind={k} cx={0} cy={0} />
              </svg>{' '}
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Where the plan and the player disagreed</h2>
        {noFelt ? (
          <p>No reaction data was captured for this playtest.</p>
        ) : report.mismatches.length === 0 ? (
          <p>No mismatches found: reactions followed your plan.</p>
        ) : (
          report.mismatches.map((m, i) => (
            <button key={i} className="mismatch" onClick={() => seek(m.start)}>
              <span className="time">
                {fmt(m.start)} to {fmt(m.end)}
              </span>
              {m.text}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
