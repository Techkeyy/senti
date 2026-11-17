// Screenshot walk for the redesigned renderer. Dev tool, not part of the app.
//
//   node src/renderer/shots.mjs <outDir> [sessionsDirToCopy]
//
// Launches the BUILT app (run `npm run build` first) with a throw-away user-data dir and drives it over the
// Chromium debugging port, switching screens with the "#dev-..." hashes. It never starts sensing and never opens the
// camera: #dev-camera, #dev-baseline and #dev-play use synthetic readings. Pass a sessions folder (for example
// %APPDATA%/senti/sessions) to copy real saved sessions into the throw-away dir for the home list and the report.
import { spawn, execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const outDir = resolve(process.argv[2] ?? join(root, 'out', 'shots', 'redesign'))
const copyFrom = process.argv[3] ? resolve(process.argv[3]) : null
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function syntheticSession(id) {
  const sample = (t, head, extra = {}) => ({ t, face: true, headSpeedMax: head, headSpeedMedian: head / 2, talking: 0, fear: null, surprise: null, neutral: null, samples: 14, ...extra })
  const calm = (t) => 0.12 + 0.1 * Math.abs(Math.sin(t * 1.7))
  const spikes = { 30: 4.6, 100: 3.4, 101: 1.4, 150: 2.2 }
  const baseline = Array.from({ length: 30 }, (_, i) => sample(i - 30, calm(i)))
  const samples = []
  for (let t = 0; t < 170; t++) {
    if (t >= 120 && t <= 134) samples.push({ ...sample(t, null), face: false, headSpeedMedian: null })
    else samples.push(sample(t, spikes[t] ?? calm(t), t >= 100 && t <= 102 ? { talking: 0.9 } : {}))
  }
  return {
    id, name: 'Synthetic demo (dev only)', createdAt: new Date().toISOString(), plannedSec: 180,
    intended: [{ t: 0, level: 10 }, { t: 60, level: 30 }, { t: 100, level: 95 }, { t: 130, level: 95 }, { t: 160, level: 40 }, { t: 180, level: 15 }],
    beats: [{ t: 100, label: 'Jump scare' }, { t: 140, label: 'Boss appears' }], markers: [{ t: 45 }, { t: 101 }],
    baseline, samples, playStartedAtMs: Date.now(), playedSec: 170, recording: { file: 'gameplay.webm', bytes: 1 },
    sensing: { restarts: 0, signals: [] }, consent: { acceptedAt: new Date().toISOString() }
  }
}

async function launch(withSessions, PORT = 9333) {
  const ud = mkdtempSync(join(tmpdir(), 'senti-shots-'))
  if (withSessions && copyFrom) {
    mkdirSync(join(ud, 'sessions'), { recursive: true })
    for (const d of readdirSync(copyFrom)) {
      if (existsSync(join(copyFrom, d, 'session.json'))) cpSync(join(copyFrom, d), join(ud, 'sessions', d), { recursive: true })
    }
    // One clearly synthetic session (reuses the first real recording) so the report shows flinches. Temp dir only.
    const first = readdirSync(join(ud, 'sessions'))[0]
    if (first) {
      mkdirSync(join(ud, 'sessions', 'synthetic-demo'), { recursive: true })
      cpSync(join(ud, 'sessions', first, 'gameplay.webm'), join(ud, 'sessions', 'synthetic-demo', 'gameplay.webm'))
      writeFileSync(join(ud, 'sessions', 'synthetic-demo', 'session.json'), JSON.stringify(syntheticSession('synthetic-demo')))
    }
  }
  const exe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('SENTI_')) delete env[k]
  const child = spawn(exe, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`], { cwd: root, env, stdio: 'ignore' })
  let targets
  for (let i = 0; i < 80; i++) {
    await sleep(250)
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {
      /* not up yet */
    }
  }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const waiting = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && waiting.has(d.id)) waiting.get(d.id)(d)
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id
      const timer = setTimeout(() => res({ error: 'timeout ' + method }), 15000)
      waiting.set(n, (d) => (clearTimeout(timer), res(d)))
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
  const close = () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
    try {
      rmSync(ud, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  return { send, evalJs, close }
}

async function main() {
  // Run 1: empty user data (key screen, empty home, the rest of the flow).
  let app = await launch(false)
  const { send, evalJs } = app
  const shot = async (name, full = false) => {
    let params = { format: 'png' }
    if (full) {
      const h = await evalJs('document.documentElement.scrollHeight')
      const w = await evalJs('document.documentElement.clientWidth')
      params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }
    }
    let r = await send('Page.captureScreenshot', params)
    if (!r.result) r = await send('Page.captureScreenshot', params)
    if (!r.result) return console.log('FAILED', name, r.error)
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    console.log('SHOT', name)
  }
  const go = async (hash, wait = 1800) => {
    await evalJs(`location.hash = ${JSON.stringify(hash)}`)
    await sleep(wait)
  }
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
  const click = async (sel) => {
    await evalJs(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'center' })`)
    await sleep(120)
    const p = await rectOf(sel)
    if (!p) return console.log('no element', sel)
    await mouse('mouseMoved', p.x, p.y)
    await mouse('mousePressed', p.x, p.y)
    await mouse('mouseReleased', p.x, p.y)
  }
  const type = async (sel, text) => {
    await click(sel)
    await send('Input.insertText', { text })
  }

  await sleep(2500)
  await go('#dev-key', 2600)
  await shot('01-key')
  await go('#dev-home', 2200)
  await shot('02-home-empty')
  await go('#dev-new', 1800)
  await shot('03-new')
  // Add a name and a beat, then drag the peak point and capture while the button is still down.
  await type('#pname', 'Level 2, first playtest')
  await type('#blabel', 'Jump scare')
  await type('#btime', '3:00')
  await click('button.btn:not(.primary):not(.ghost)')
  await sleep(500)
  await evalJs('window.scrollTo(0, 0)')
  await sleep(200)
  const handle = await rectOf('[data-handle="3"]')
  if (handle) {
    await mouse('mouseMoved', handle.x, handle.y)
    await mouse('mousePressed', handle.x, handle.y)
    await mouse('mouseMoved', handle.x - 18, handle.y - 30)
    await mouse('mouseMoved', handle.x - 34, handle.y - 58)
    await sleep(300)
    console.log('HANDLE OUTLINE', await evalJs('getComputedStyle(document.querySelector("[data-handle=\"3\"]")).outline'))
    await shot('04-new-dragging')
    await mouse('mouseReleased', handle.x - 34, handle.y - 58)
  }
  await go('#dev-consent', 1500)
  await shot('05-consent')
  await go('#dev-camera', 1500)
  await shot('06-camera-hint')
  await go('#dev-camera-ready', 1500)
  await sleep(3400)
  await shot('07-camera-ready')
  await go('#dev-baseline', 3000)
  await shot('08-baseline')
  await go('#dev-ready', 1500)
  await shot('09-ready')
  await go('#dev-play', 3500)
  await shot('10-play')
  await go('#dev-settings', 1500)
  await shot('11-settings')
  app.close()
  await sleep(1500)

  // Run 2: with real saved sessions copied in (home list, report).
  if (copyFrom) {
    app = await launch(true, 9334)
    const a = app
    await sleep(2500)
    let list
    for (let i = 0; i < 8 && !list; i++) {
      list = await a.evalJs('window.senti.sessionsList().then(l => JSON.stringify(l))')
      if (!list) await sleep(1000)
    }
    console.log('SESSIONS', list)
    const sessions = JSON.parse(list ?? '[]')
    const shot2 = async (name, full = false) => {
      let params = { format: 'png' }
      if (full) {
        const h = await a.evalJs('document.documentElement.scrollHeight')
        const w = await a.evalJs('document.documentElement.clientWidth')
        params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }
      }
      let r = await a.send('Page.captureScreenshot', params)
      if (!r.result) r = await a.send('Page.captureScreenshot', params)
      if (!r.result) return console.log('FAILED', name, r.error)
      writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'))
      console.log('SHOT', name)
    }
    await a.evalJs(`location.hash = '#dev-home'`)
    await sleep(3000)
    await shot2('12-home-sessions')
    const real = sessions.find((s) => s.id !== 'synthetic-demo')
    if (real) {
      await a.evalJs(`location.hash = ${JSON.stringify('#dev-report:' + real.id)}`)
      await sleep(3500)
      await shot2('13-report-real', true)
    }
    await a.evalJs(`location.hash = '#dev-report:synthetic-demo'`)
    await sleep(3500)
    await shot2('14-report-synthetic', true)
    const sx = await a.evalJs('(() => { const e = document.querySelector(".flinch-mark"); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
    if (sx) {
      await a.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx.x, y: sx.y })
      await sleep(400)
      await shot2('15-report-tooltip', true)
    }
    a.close()
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
