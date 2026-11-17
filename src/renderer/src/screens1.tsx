import { useEffect, useState } from 'react'
import type { SessionSummary } from '../../shared/ipc'
import type { Beat, IntendedPoint } from '../../shared/session'
import CurveEditor from './CurveEditor'
import { defaultCurve, fmt, parseTime, rescaleCurve } from './util'

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
    <a href={REGISTER_URL} target="_blank" rel="noreferrer">
      Get a free key
    </a>
  )
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
    <div className="page narrow stack">
      <div className="brand">Senti</div>
      <h1>One quick setup step</h1>
      <p>Senti reads reactions with Presage SmartSpectra. Paste your free Presage API key.</p>
      <p>
        <RegisterLink />
      </p>
      <div>
        <label className="label" htmlFor="key">
          Presage API key
        </label>
        <input
          id="key"
          type="password"
          value={key}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !key.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save key'}
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
      <p className="dim">The key stays on this computer, encrypted by Windows.</p>
    </div>
  )
}

export function cleanErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  // Electron prefixes IPC errors with "Error invoking remote method '...': Error: "
  return m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
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
    <div className="page narrow stack">
      <div className="row spread">
        <h1>Settings</h1>
        <button onClick={onBack}>Back</button>
      </div>
      <div className="card stack">
        <h2>Presage API key</h2>
        <p>{hasKey === null ? 'Checking…' : hasKey ? 'A key is saved on this computer.' : 'No key is saved.'}</p>
        <div className="row">
          <button onClick={() => setReplacing(true)}>Replace key</button>
          <button className="danger" disabled={!hasKey} onClick={() => void remove()}>
            Remove key
          </button>
        </div>
        {info && <p className="ok">{info}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  )
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

  return (
    <div className="page stack">
      <div className="topbar">
        <div className="brand">Senti</div>
        <div className="row">
          <button onClick={onSettings}>Settings</button>
          <button className="primary" onClick={onNew}>
            New playtest
          </button>
        </div>
      </div>
      <h1>Playtests</h1>
      {error && <p className="error">{error}</p>}
      {list === null && <p className="dim">Loading playtests…</p>}
      {list !== null && list.length === 0 && !error && (
        <div className="card empty">
          <p>No playtests yet. Run your first one in about 5 minutes.</p>
        </div>
      )}
      {list !== null && list.length > 0 && (
        <div className="card">
          {list.map((s) => (
            <div className="session" key={s.id}>
              <div>
                <div className="name">{s.name}</div>
                <div className="dim" style={{ fontSize: 'var(--fs-label)' }}>
                  {new Date(s.createdAt).toLocaleString()} · {fmt(s.playedSec)} played
                  {s.hasRecording ? '' : ' · no recording'}
                </div>
              </div>
              <div className="row">
                <button onClick={() => onOpen(s.id)}>Open report</button>
                <button className="danger" onClick={() => setConfirm(s)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirm && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal stack">
            <h2>Delete “{confirm.name}”?</h2>
            <p>Delete this playtest and its recording? This cannot be undone.</p>
            <div className="row">
              <button className="danger" disabled={deleting} onClick={() => void doDelete()}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button disabled={deleting} onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function NewPlaytest({ onCancel, onContinue }: { onCancel: () => void; onContinue: (d: Draft) => void }) {
  const [name, setName] = useState('')
  const [plannedSec, setPlannedSec] = useState(300)
  const [minutesText, setMinutesText] = useState('5')
  const [intended, setIntended] = useState<IntendedPoint[]>(() => defaultCurve(300))
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

  const canContinue = name.trim().length > 0

  return (
    <div className="page stack">
      <div className="row spread">
        <h1>New playtest</h1>
        <button onClick={onCancel}>Cancel</button>
      </div>

      <div className="card stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="label" htmlFor="pname">
              Name
            </label>
            <input id="pname" type="text" value={name} placeholder="Level 2, first playtest" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="mins">
              Planned length (minutes)
            </label>
            <input
              id="mins"
              type="number"
              min={1}
              max={120}
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={(e) => e.key === 'Enter' && commitMinutes()}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: 0 }}>Senti records your screen while you play. Put your game on this screen.</p>
      </div>

      <div className="card stack">
        <h2>Intended tension curve</h2>
        <p className="dim">Draw how tense this level should feel over time. Senti compares it with what the player actually did.</p>
        <CurveEditor plannedSec={plannedSec} points={intended} beats={beats} onChange={setIntended} />
        <h2 style={{ marginTop: 8 }}>Beats</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label className="label" htmlFor="blabel">
              Beat name
            </label>
            <input id="blabel" type="text" value={beatLabel} placeholder="Jump scare" onChange={(e) => setBeatLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBeat()} />
          </div>
          <div>
            <label className="label" htmlFor="btime">
              Time (m:ss)
            </label>
            <input id="btime" type="text" style={{ width: 100 }} value={beatTime} placeholder="2:10" onChange={(e) => setBeatTime(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBeat()} />
          </div>
          <button onClick={addBeat}>Add beat</button>
        </div>
        {beatError && <p className="error">{beatError}</p>}
        {beats.length > 0 && (
          <ul className="plain">
            {beats.map((b, i) => (
              <li key={i}>
                <span style={{ fontFamily: 'var(--mono)' }}>{fmt(b.t)}</span>
                <span>{b.label}</span>
                <button className="link" onClick={() => setBeats(beats.filter((_, k) => k !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row">
        <button
          className="primary"
          disabled={!canContinue}
          onClick={() => onContinue({ name: name.trim(), plannedSec, intended, beats })}
        >
          Continue
        </button>
        {!canContinue && <span className="dim">Add a name to continue.</span>}
      </div>
    </div>
  )
}
