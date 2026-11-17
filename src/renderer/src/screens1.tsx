import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Monitor, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import type { SessionSummary } from '../../shared/ipc'
import type { Beat, IntendedPoint, Report as ReportData, Session } from '../../shared/session'
import { computeReport } from '../../shared/felt'
import CurveEditor from './CurveEditor'
import { ExampleTimeline, FaintLine } from './ExampleLine'
import { Shell } from './Shell'
import Timeline from './Timeline'
import { SHAPES, shapePoints, type Shape } from './shapes'
import { monotone, toPts } from './chart'
import { defaultCurve, fmt, fmtDate, parseTime, plural, rescaleCurve, totalSec } from './util'

const REGISTER_URL = 'https://physiology.presagetech.com/auth/register'

export interface Draft {
  name: string
  plannedSec: number
  intended: IntendedPoint[]
  beats: Beat[]
}

/** Link opened by main in the external browser (main allows only the Presage https host). */
function RegisterLink() {
  return (
    <a href={REGISTER_URL} target="_blank" rel="noreferrer" className="row" style={{ display: 'inline-flex', gap: 6 }}>
      Get a free key
      <ExternalLink size={14} strokeWidth={1.5} className="ico" aria-hidden="true" />
    </a>
  )
}

export function cleanErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  // Electron prefixes IPC errors with "Error invoking remote method '...': Error: "
  return m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

export function KeyScreen({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await window.senti.keySet(key)
      onSaved()
    } catch (e) {
      setError(cleanErr(e))
      setBusy(false)
    }
  }

  return (
    <Shell bare>
      <div className="key-screen">
        <FaintLine />
        <span className="example-tag example-caption">Example</span>
        <div className="key-body stack-lg enter" style={{ padding: '12vh 32px 0' }}>
          <div className="stack">
            <h1>Add your Presage key</h1>
            <p className="t2">
              Senti uses your webcam to notice when a playtester startles, talks or looks away, then compares that with the tension you planned.
            </p>
          </div>
          <div className="field">
            <label htmlFor="key">Presage API key</label>
            <input
              id="key"
              type="password"
              value={key}
              autoComplete="off"
              autoFocus
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button className="btn primary" disabled={busy || !key.trim()} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {onCancel && (
              <button className="btn ghost" onClick={onCancel}>
                Cancel
              </button>
            )}
            <span className="grow" />
            <RegisterLink />
          </div>
          <p className="muted small">The key stays on this computer, encrypted by Windows.</p>
        </div>
      </div>
    </Shell>
  )
}

export function Settings({ onBack, onKeyRemoved }: { onBack: () => void; onKeyRemoved: () => void }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    window.senti.keyStatus().then((s) => setHasKey(s.hasKey), () => setHasKey(false))
  }, [])

  async function remove(): Promise<void> {
    setError('')
    try {
      const s = await window.senti.keyClear()
      if (s.hasKey) setInfo('The saved key was removed, but a development key file is still in use.')
      else onKeyRemoved()
    } catch (e) {
      setError(cleanErr(e))
    }
  }

  if (replacing) return <KeyScreen onSaved={() => (setReplacing(false), setInfo('Key saved.'), setHasKey(true))} onCancel={() => setReplacing(false)} />

  return (
    <Shell
      width="narrow"
      right={
        <button className="btn ghost" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
      }
    >
      <div className="stack-lg enter">
        <h1>Settings</h1>
        <div className="card stack">
          <h2>Presage API key</h2>
          <p className="t2">{hasKey === null ? 'Checking…' : hasKey ? 'A key is saved on this computer.' : 'No key is saved.'}</p>
          <div className="row">
            <button className="btn" onClick={() => setReplacing(true)}>
              Replace key
            </button>
            <button className="btn danger" disabled={!hasKey} onClick={() => void remove()}>
              Remove key
            </button>
          </div>
          {info && <p className="ok" role="status">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    </Shell>
  )
}

interface Loaded {
  session: Session
  report: ReportData
}

function useLoaded(list: SessionSummary[] | null): Record<string, Loaded | 'failed'> {
  const [loaded, setLoaded] = useState<Record<string, Loaded | 'failed'>>({})
  useEffect(() => {
    if (!list) return
    let live = true
    for (const s of list) {
      window.senti.sessionsGet(s.id).then(
        (session) => {
          if (!live) return
          let entry: Loaded | 'failed' = 'failed'
          if (session) {
            try {
              entry = { session, report: computeReport(session) }
            } catch {
              entry = 'failed'
            }
          }
          setLoaded((m) => ({ ...m, [s.id]: entry }))
        },
        () => live && setLoaded((m) => ({ ...m, [s.id]: 'failed' }))
      )
    }
    return () => {
      live = false
    }
  }, [list])
  return loaded
}

export function reportCounts(r: ReportData): string {
  if (r.felt.length === 0) return 'No reaction data'
  const flinches = r.moments.filter((m) => m.kind === 'startle').length
  return `${plural(flinches, 'flinch', 'flinches')} · ${plural(r.mismatches.length, 'mismatch', 'mismatches')}`
}

export function Home({
  onNew,
  onOpen,
  onSettings
}: {
  onNew: () => void
  onOpen: (id: string) => void
  onSettings: () => void
}) {
  const [list, setList] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<SessionSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const loaded = useLoaded(list)

  async function load(): Promise<void> {
    try {
      setList(await window.senti.sessionsList())
      setError('')
    } catch (e) {
      setError(cleanErr(e))
      setList([])
    }
  }
  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !deleting) setConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, deleting])

  async function doDelete(): Promise<void> {
    if (!confirm) return
    setDeleting(true)
    try {
      await window.senti.sessionsDelete(confirm.id)
      setConfirm(null)
      await load()
    } catch (e) {
      setError(`Could not delete: ${cleanErr(e)}`)
      setConfirm(null)
    }
    setDeleting(false)
  }

  const empty = list !== null && list.length === 0 && !error

  return (
    <Shell
      right={
        <button className="btn ghost" onClick={onSettings}>
          <SettingsIcon size={16} aria-hidden="true" />
          Settings
        </button>
      }
    >
      {!empty && (
        <div className="page-head enter">
          <h1>Playtests</h1>
          <button className="btn primary" onClick={onNew}>
            <Plus size={16} aria-hidden="true" />
            New playtest
          </button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {list === null && <p className="muted">Loading playtests…</p>}

      {empty && (
        <div className="card empty-hero enter stack-lg">
          <div className="row spread" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ maxWidth: 560 }}>
              <h1>Draw how your level should feel, then watch a real player react</h1>
              <p className="t2">Senti plots your plan against what a playtester&rsquo;s webcam notices, and shows where the two disagree.</p>
              <div>
                <button className="btn primary big" onClick={onNew}>
                  New playtest
                </button>
              </div>
            </div>
            <span className="example-tag">Example</span>
          </div>
          <ExampleTimeline />
        </div>
      )}

      {list !== null && list.length > 0 && (
        <div className="session-list">
          {list.map((s, i) => {
            const l = loaded[s.id]
            const ready = l && l !== 'failed'
            return (
              <div className={`session-row enter${i < 4 ? ` d${i}` : ''}`} key={s.id}>
                <button className="row-open" onClick={() => onOpen(s.id)} aria-label={`Open report for ${s.name}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="session-name">{s.name}</div>
                  <div className="session-meta">
                    {fmtDate(s.createdAt)} &middot; {fmt(s.playedSec)} played{s.hasRecording ? '' : ' · no recording'}
                  </div>
                  <div className="session-meta counts">{ready ? reportCounts(l.report) : l === 'failed' ? 'Could not read this playtest' : ' '}</div>
                </div>
                <div className="line-slot">
                  {ready && (
                    <Timeline
                      variant="mini"
                      intended={l.session.intended}
                      felt={l.report.felt}
                      total={totalSec(l.session, l.report)}
                      moments={l.report.moments}
                      mismatches={l.report.mismatches}
                      label={`Intended and felt tension for ${s.name}`}
                    />
                  )}
                </div>
                <button className="btn ghost icon" aria-label={`Delete ${s.name}`} title="Delete" onClick={() => setConfirm(s)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {confirm && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="del-title">
          <div className="modal stack">
            <h2 id="del-title">Delete “{confirm.name}”?</h2>
            <p className="t2">Delete this playtest and its recording? This cannot be undone.</p>
            <div className="row">
              <button className="btn danger" disabled={deleting} onClick={() => void doDelete()}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button className="btn ghost" autoFocus disabled={deleting} onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

function ShapePreview({ shape }: { shape: Shape }) {
  const w = 84
  const h = 32
  const d = useMemo(() => {
    const c = monotone(toPts(shape.pts.map(([f, level]) => ({ t: f * 100, level }))))
    return c.path((t) => 2 + (t / 100) * (w - 4), (v) => h - 3 - (v / 100) * (h - 6))
  }, [shape])
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--text)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}

export function NewPlaytest({ onCancel, onContinue }: { onCancel: () => void; onContinue: (d: Draft) => void }) {
  const [name, setName] = useState('')
  const [plannedSec, setPlannedSec] = useState(300)
  const [minutesText, setMinutesText] = useState('5')
  const [intended, setIntended] = useState<IntendedPoint[]>(() => defaultCurve(300))
  const [edited, setEdited] = useState(false)
  const [pendingShape, setPendingShape] = useState<Shape | null>(null)
  const [beats, setBeats] = useState<Beat[]>([])
  const [beatLabel, setBeatLabel] = useState('')
  const [beatTime, setBeatTime] = useState('')
  const [beatError, setBeatError] = useState('')

  function commitMinutes(): void {
    const n = Number(minutesText)
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      setMinutesText(String(plannedSec / 60))
      return
    }
    const next = Math.round(n * 60)
    if (next === plannedSec) return
    setIntended(rescaleCurve(intended, plannedSec, next))
    setBeats(beats.filter((b) => b.t <= next))
    setPlannedSec(next)
    setMinutesText(String(next / 60))
    setPendingShape(null)
  }

  function addBeat(): void {
    const t = parseTime(beatTime)
    if (!beatLabel.trim()) return setBeatError('Give the beat a name, for example “Jump scare”.')
    if (t === null) return setBeatError('Enter the time as m:ss, for example 2:10.')
    if (t > plannedSec) return setBeatError(`That is after the planned length (${fmt(plannedSec)}).`)
    setBeats([...beats, { t, label: beatLabel.trim() }].sort((a, b) => a.t - b.t))
    setBeatLabel('')
    setBeatTime('')
    setBeatError('')
  }

  function applyShape(s: Shape): void {
    setIntended(shapePoints(s, plannedSec))
    setEdited(false)
    setPendingShape(null)
  }

  function pickShape(s: Shape): void {
    if (edited) setPendingShape(s)
    else applyShape(s)
  }

  const canContinue = name.trim().length > 0

  return (
    <Shell
      right={
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      <div className="stack-lg enter">
        <div className="row" style={{ alignItems: 'flex-end', gap: 32 }}>
          <div className="field grow" style={{ minWidth: 280 }}>
            <label htmlFor="pname">Name</label>
            <input id="pname" className="name-input" type="text" value={name} placeholder="Level 2, first playtest" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="mins">Planned length (minutes)</label>
            <input
              id="mins"
              className="mono"
              type="number"
              min={1}
              max={120}
              style={{ width: 120 }}
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={(e) => e.key === 'Enter' && commitMinutes()}
            />
          </div>
        </div>

        <div className="stack">
          <div className="row spread">
            <div>
              <h2>Intended tension curve</h2>
              <p className="t2 small" style={{ marginTop: 2 }}>
                Draw how tense this level should feel over time. Senti compares it with what the player actually did.
              </p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {SHAPES.map((s) => (
                <button key={s.id} className="shape-btn" onClick={() => pickShape(s)} aria-label={`Start from ${s.label}`}>
                  <ShapePreview shape={s} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          {pendingShape && (
            <div className="confirm-strip" role="alertdialog" aria-label="Replace the curve">
              <span>Replace your edited curve with {pendingShape.label}?</span>
              <button className="btn" onClick={() => applyShape(pendingShape)}>
                Replace
              </button>
              <button className="btn ghost" onClick={() => setPendingShape(null)}>
                Keep mine
              </button>
            </div>
          )}
          <CurveEditor
            plannedSec={plannedSec}
            points={intended}
            beats={beats}
            onChange={(p) => (setIntended(p), setEdited(true))}
            onBeatsChange={setBeats}
          />
          <p className="muted small">
            Click to add a point, drag to move it, right-click or press Delete to remove it. Height is how tense this moment should feel, from 0 (calm) to 100 (peak).
          </p>
        </div>

        <div className="stack">
          <h2>Beats</h2>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field grow" style={{ minWidth: 200, maxWidth: 360 }}>
              <label htmlFor="blabel">Beat name</label>
              <input id="blabel" type="text" value={beatLabel} placeholder="Jump scare" onChange={(e) => setBeatLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBeat()} />
            </div>
            <div className="field">
              <label htmlFor="btime">Time (m:ss)</label>
              <input id="btime" className="mono" type="text" style={{ width: 100 }} value={beatTime} placeholder="2:10" onChange={(e) => setBeatTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBeat()} />
            </div>
            <button className="btn" onClick={addBeat}>
              Add beat
            </button>
          </div>
          {beatError && <p className="error" role="alert">{beatError}</p>}
          <p className="muted small">Beats appear as flags on the curve. Drag a flag sideways to move it, or select it and press Delete.</p>
        </div>

        <div className="row spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
          <p className="t2 row" style={{ gap: 10 }}>
            <Monitor size={16} strokeWidth={1.5} className="ico" aria-hidden="true" />
            Senti records your screen while you play. Put your game on this screen.
          </p>
          <div className="row">
            {!canContinue && <span className="muted small">Add a name to continue.</span>}
            <button className="btn primary" disabled={!canContinue} onClick={() => onContinue({ name: name.trim(), plannedSec, intended, beats })}>
              Continue
            </button>
          </div>
        </div>
      </div>
    </Shell>
  )
}
