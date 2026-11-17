// OWNER: UI builder. Session storage in userData/sessions/<id>/, the senti-media:// protocol for
// recordings, F8/F9 global hotkeys during play, and the register-link opener.
// See src/shared/session.ts and src/shared/ipc.ts.
import { app, globalShortcut, ipcMain, net, protocol, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { IPC, type SessionSummary } from '../shared/ipc'
import type { Session } from '../shared/session'

const SCHEME = 'senti-media'
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const ALLOWED_EXTERNAL_HOSTS = new Set(['physiology.presagetech.com'])

const sessionsRoot = (): string => join(app.getPath('userData'), 'sessions')
const sessionDir = (id: string): string => join(sessionsRoot(), id)

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Invalid session id.')
  return id
}

/** Call before app ready (privileged scheme registration). */
export function registerSessionSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
  ])
}

// ---------- storage ----------

async function listSessions(): Promise<SessionSummary[]> {
  let names: string[] = []
  try {
    names = await readdir(sessionsRoot())
  } catch {
    return []
  }
  const out: SessionSummary[] = []
  for (const name of names) {
    if (!ID_RE.test(name)) continue
    try {
      const s = JSON.parse(await readFile(join(sessionDir(name), 'session.json'), 'utf8')) as Session
      let hasRecording = false
      if (s.recording) {
        hasRecording = await stat(join(sessionDir(name), s.recording.file)).then(
          (st) => st.isFile(),
          () => false
        )
      }
      out.push({ id: name, name: s.name, createdAt: s.createdAt, playedSec: s.playedSec, hasRecording })
    } catch {
      /* folder without a valid session.json (e.g. old spike recordings): skip */
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return out
}

async function getSession(id: string): Promise<Session | null> {
  assertId(id)
  try {
    return JSON.parse(await readFile(join(sessionDir(id), 'session.json'), 'utf8')) as Session
  } catch {
    return null
  }
}

async function saveSession(session: Session, recording: ArrayBuffer | Uint8Array | null): Promise<void> {
  if (!session || typeof session !== 'object') throw new Error('Invalid session.')
  const id = assertId(session.id)
  const dir = sessionDir(id)
  await mkdir(dir, { recursive: true })
  const toWrite: Session = { ...session }
  if (recording && (recording as ArrayBuffer).byteLength > 0) {
    const buf = Buffer.from(recording as ArrayBuffer)
    await writeFile(join(dir, 'gameplay.webm'), buf)
    toWrite.recording = { file: 'gameplay.webm', bytes: buf.length }
  } else {
    toWrite.recording = null
  }
  // Write to a temp file then rename, so a crash never leaves a half-written session.json.
  const tmp = join(dir, 'session.json.tmp')
  await writeFile(tmp, JSON.stringify(toWrite))
  await rename(tmp, join(dir, 'session.json'))
}

async function deleteSession(id: string): Promise<void> {
  assertId(id)
  await rm(sessionDir(id), { recursive: true, force: true })
}

// ---------- senti-media:// with Range support ----------

const MAX_CHUNK = 4 * 1024 * 1024

async function handleMedia(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (!ID_RE.test(id)) return new Response('Bad id', { status: 400 })
    const path = join(sessionDir(id), 'gameplay.webm')
    const st = await stat(path).catch(() => null)
    if (!st || !st.isFile()) return new Response('Not found', { status: 404 })
    const size = st.size
    const base = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }
    // Serve byte ranges from a plain file read, capped per response. No Node-to-web stream: the player cancels
    // requests when it seeks, and a cancelled stream conversion crashed the main process (seen 17 Nov, report
    // shown right after saving). A capped 206 is valid HTTP; the player simply asks for the next range.
    const range = request.headers.get('range') ?? 'bytes=0-'
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      return new Response('Bad range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    let start: number
    let end: number
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    } else {
      start = Number(m[1])
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    }
    if (start >= size || start > end) {
      return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    end = Math.min(end, start + MAX_CHUNK - 1)
    const buf = Buffer.alloc(end - start + 1)
    const fh = await open(path, 'r')
    try {
      await fh.read(buf, 0, buf.length, start)
    } finally {
      await fh.close()
    }
    return new Response(buf, {
      status: 206,
      headers: { ...base, 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` }
    })
  } catch {
    return new Response('Error', { status: 500 })
  }
}

// ---------- hotkeys ----------

function setHotkeys(on: boolean, getWindow: () => BrowserWindow | null): void {
  globalShortcut.unregister('F8')
  globalShortcut.unregister('F9')
  if (!on) return
  const push = (k: 'marker' | 'stop') => (): void => {
    getWindow()?.webContents.send(IPC.hotkey, k)
  }
  const ok8 = globalShortcut.register('F8', push('marker'))
  const ok9 = globalShortcut.register('F9', push('stop'))
  if (!ok8 || !ok9) {
    globalShortcut.unregister('F8')
    globalShortcut.unregister('F9')
    throw new Error('Another app is using F8 or F9, so the hotkeys are off. Use the Stop button in Senti.')
  }
}

// ---------- external links (register page only) ----------

function guardExternalLinks(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url)
        if (u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) void shell.openExternal(u.toString())
      } catch {
        /* ignore malformed urls */
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      // The app never navigates away from itself (dev server or file).
      const cur = contents.getURL()
      if (url !== cur && !url.startsWith(cur.split('#')[0])) event.preventDefault()
    })
  })
}

/** Call after app ready. */
export function registerSessions(getWindow: () => BrowserWindow | null): void {
  guardExternalLinks()
  protocol.handle(SCHEME, (request) => handleMedia(request))
  ipcMain.handle(IPC.sessionsList, () => listSessions())
  ipcMain.handle(IPC.sessionsGet, (_e, id: string) => getSession(id))
  ipcMain.handle(IPC.sessionsSave, (_e, session: Session, rec: ArrayBuffer | null) => saveSession(session, rec))
  ipcMain.handle(IPC.sessionsDelete, (_e, id: string) => deleteSession(id))
  ipcMain.handle(IPC.hotkeysEnable, (_e, on: boolean) => setHotkeys(Boolean(on), getWindow))
  app.on('will-quit', () => globalShortcut.unregisterAll())

  if (process.env.SENTI_STORAGE_TEST === '1') void storageSelfTest()
  if (process.env.SENTI_SEEKTEST === '1') void seekTestTrigger(getWindow)
  if (process.env.SENTI_SCREENSHOTS) void screenshotWalk(getWindow, process.env.SENTI_SCREENSHOTS)
}

// ---------- dev-only self tests (env flags; never active for end users) ----------

function syntheticSession(id: string): Session {
  return {
    id,
    name: 'Storage test',
    createdAt: new Date().toISOString(),
    plannedSec: 60,
    intended: [
      { t: 0, level: 10 },
      { t: 30, level: 80 },
      { t: 60, level: 10 }
    ],
    beats: [{ t: 30, label: 'Peak' }],
    markers: [{ t: 12.5 }],
    baseline: [],
    samples: [],
    playStartedAtMs: Date.now(),
    playedSec: 58,
    recording: null,
    sensing: { restarts: 0, signals: [] },
    consent: { acceptedAt: new Date().toISOString() }
  }
}

async function storageSelfTest(): Promise<void> {
  const log = (s: string): void => void process.stdout.write(`SENTI_STORAGETEST ${s}\n`)
  const id = `selftest-${Date.now().toString(36)}`
  const results: Record<string, unknown> = {}
  try {
    const bytes = Buffer.alloc(4096)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    await saveSession(syntheticSession(id), bytes)
    const list = await listSessions()
    results.listed = list.some((s) => s.id === id && s.hasRecording)
    const got = await getSession(id)
    results.got = got?.id === id && got.recording?.bytes === 4096
    const url = `${SCHEME}://session/${id}`
    const r1 = await net.fetch(url, { headers: { Range: 'bytes=0-15' } })
    const b1 = Buffer.from(await r1.arrayBuffer())
    results.range0 = { status: r1.status, contentRange: r1.headers.get('content-range'), len: b1.length, ok: b1.equals(bytes.subarray(0, 16)) }
    const r2 = await net.fetch(url, { headers: { Range: 'bytes=4000-' } })
    const b2 = Buffer.from(await r2.arrayBuffer())
    results.rangeTail = { status: r2.status, contentRange: r2.headers.get('content-range'), len: b2.length, ok: b2.equals(bytes.subarray(4000)) }
    const r3 = await net.fetch(url)
    results.full = { status: r3.status, len: (await r3.arrayBuffer()).byteLength }
    const r4 = await net.fetch(url, { headers: { Range: 'bytes=9999-' } })
    results.badRange = r4.status
    const r5 = await net.fetch(`${SCHEME}://session/..%2F..%2Fpresage-key.bin`)
    results.traversal = r5.status
    await deleteSession(id)
    results.deleted = !(await listSessions()).some((s) => s.id === id) && (await getSession(id)) === null
    const pass =
      results.listed === true &&
      results.got === true &&
      (results.range0 as { status: number; ok: boolean }).status === 206 &&
      (results.range0 as { ok: boolean }).ok &&
      (results.rangeTail as { status: number; ok: boolean }).status === 206 &&
      (results.rangeTail as { ok: boolean }).ok &&
      (results.full as { status: number }).status === 206 &&
      results.badRange === 416 &&
      results.traversal === 400 &&
      results.deleted === true
    log(`${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(results)}`)
  } catch (e) {
    await deleteSession(id).catch(() => undefined)
    log(`FAIL ${(e as Error).message} ${JSON.stringify(results)}`)
  }
  if (!process.env.SENTI_SCREENSHOTS && !process.env.SENTI_KEEP_OPEN) app.quit()
}

async function screenshotWalk(getWindow: () => BrowserWindow | null, dir: string): Promise<void> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await mkdir(dir, { recursive: true })
  let win = getWindow()
  for (let i = 0; i < 100 && !win; i++) {
    await sleep(100)
    win = getWindow()
  }
  if (!win) return
  await sleep(2500)
  const shot = async (name: string, hash: string, scrollY = 0): Promise<void> => {
    await win!.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`)
    await sleep(1800)
    await win!.webContents.executeJavaScript(`window.scrollTo(0, ${scrollY})`)
    await sleep(300)
    const img = await win!.webContents.capturePage()
    await writeFile(join(dir, `${name}.png`), img.toPNG())
    process.stdout.write(`SENTI_SHOT ${name}\n`)
  }
  await shot('1-key', '#dev-key')
  await shot('2-home', '#dev-home')
  await shot('3-new', '#dev-new')
  await shot('3b-curve', '#dev-new', 99999)
  await shot('4-consent', '#dev-consent')
  await shot('5-camera', '#dev-camera')
  await shot('6-settings', '#dev-settings')
  // Report with a synthetic saved session (deleted afterwards).
  const id = `shots-${Date.now().toString(36)}`
  const s = syntheticSession(id)
  s.name = 'Screenshot demo'
  await saveSession(s, null)
  await shot('7-home-with-session', '#dev-home')
  await shot('8-report', `#dev-report:${id}`)
  await deleteSession(id)
  app.quit()
}

/** SENTI_SEEKTEST=1: the renderer records a synthetic video, saves it over IPC and seeks it via senti-media://. */
async function seekTestTrigger(getWindow: () => BrowserWindow | null): Promise<void> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  let win = getWindow()
  for (let i = 0; i < 100 && !win; i++) {
    await sleep(100)
    win = getWindow()
  }
  if (!win) return
  await sleep(2500)
  await win.webContents.executeJavaScript(`location.hash = '#dev-seektest'`)
  await sleep(15000)
  app.quit()
}
