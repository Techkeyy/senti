import { useEffect, useState } from 'react'
import Report from './Report'
import RunFlow from './RunFlow'
import { Home, KeyScreen, NewPlaytest, Settings, type Draft } from './screens1'
import { defaultCurve } from './util'
import { recordTest, seekTest } from './dev'

type View =
  | { name: 'loading' }
  | { name: 'key' }
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'new' }
  | { name: 'run'; draft: Draft; phase?: 'consent' | 'camera' | 'ready' }
  | { name: 'report'; id: string }

const DEMO: Draft = { name: 'Demo', plannedSec: 300, intended: defaultCurve(300), beats: [] }

/** "#dev-..." hashes are set by main only under SENTI_* dev flags (screenshot walk, self tests). */
function devView(hash: string): View | 'seektest' | 'recordtest' | null {
  if (!hash.startsWith('#dev-')) return null
  const h = hash.slice(5)
  if (h === 'key') return { name: 'key' }
  if (h === 'home') return { name: 'home' }
  if (h === 'new') return { name: 'new' }
  if (h === 'settings') return { name: 'settings' }
  if (h === 'consent') return { name: 'run', draft: DEMO, phase: 'consent' }
  if (h === 'camera') return { name: 'run', draft: DEMO, phase: 'camera' }
  if (h === 'ready') return { name: 'run', draft: DEMO, phase: 'ready' }
  if (h === 'recordtest') return 'recordtest'
  if (h.startsWith('report:')) return { name: 'report', id: h.slice(7) }
  if (h === 'seektest') return 'seektest'
  return null
}

export default function App() {
  const [view, setView] = useState<View>({ name: 'loading' })

  async function goStart(): Promise<void> {
    try {
      const { hasKey } = await window.senti.keyStatus()
      setView(hasKey ? { name: 'home' } : { name: 'key' })
    } catch {
      setView({ name: 'key' })
    }
  }

  useEffect(() => {
    const apply = (): void => {
      const d = devView(window.location.hash)
      if (d === 'seektest') void seekTest()
      else if (d === 'recordtest') void recordTest()
      else if (d) setView(d)
    }
    if (window.location.hash.startsWith('#dev-')) apply()
    else void goStart()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  const home = (): void => setView({ name: 'home' })

  switch (view.name) {
    case 'loading':
      return <div className="page"><p className="dim">Starting Senti…</p></div>
    case 'key':
      return <KeyScreen onSaved={home} />
    case 'home':
      return <Home onNew={() => setView({ name: 'new' })} onOpen={(id) => setView({ name: 'report', id })} onSettings={() => setView({ name: 'settings' })} />
    case 'settings':
      return <Settings onBack={home} onKeyRemoved={() => setView({ name: 'key' })} />
    case 'new':
      return <NewPlaytest onCancel={home} onContinue={(draft) => setView({ name: 'run', draft })} />
    case 'run':
      return <RunFlow key={view.phase ?? 'run'} draft={view.draft} initialPhase={view.phase} onCancel={home} onSaved={(id) => setView({ name: 'report', id })} />
    case 'report':
      return <Report id={view.id} onBack={home} />
  }
}
