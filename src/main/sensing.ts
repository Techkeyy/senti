// OWNER: sensing builder. Main-side controller for the camera reader. The Presage SDK runs in an Electron
// utilityProcess (sensing-worker.ts) so its per-frame work never competes with the UI or screen capture.
// This file forks the worker, relays commands to it, and forwards SensingEvent / PreviewFrame to the renderer.
import { app, ipcMain, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import type { SensingPhase, SensingEvent } from '../shared/session'
import type { FromWorker, SensingResult, ToWorker } from './sensing-protocol'
import { getApiKey } from './settings'

/**
 * Packaged app: require.resolve finds the SDK's native package inside app.asar, but LoadLibrary needs a real file.
 * asarUnpack puts it in app.asar.unpacked, so point the SDK's documented override there.
 */
function workerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (app.isPackaged && !env.SMARTSPECTRA_CAPI_PATH) {
    env.SMARTSPECTRA_CAPI_PATH = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@smartspectra',
      'node-sdk-win32-x64',
      'smartspectra_capi.dll'
    )
  }
  return env
}

const STOP_TIMEOUT_MS = 12_000
const CRASH_MESSAGE = 'The camera reader stopped unexpectedly. Press Retry.'
const EMPTY: SensingResult = { baseline: [], samples: [], restarts: 0, signals: [] }

let getWin: () => BrowserWindow | null = () => null
let worker: UtilityProcess | null = null
let stopWaiter: ((r: SensingResult) => void) | null = null
let previewFrames = 0
let onEventTap: ((e: SensingEvent) => void) | null = null

const post = (m: ToWorker): void => void worker?.postMessage(m)

function pushEvent(ev: SensingEvent): void {
  onEventTap?.(ev)
  getWin()?.webContents.send(IPC.sensingEvent, ev)
}

function startSensing(): void {
  if (worker) return
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Add your Presage API key first.')
  previewFrames = 0
  const w = utilityProcess.fork(join(__dirname, 'sensing-worker.js'), [], { serviceName: 'senti-sensing', env: workerEnv() })
  worker = w
  w.on('message', (m: FromWorker) => {
    if (worker !== w) return
    if (m.type === 'event') pushEvent(m.event)
    else if (m.type === 'preview') {
      previewFrames++
      getWin()?.webContents.send(IPC.sensingPreview, m.frame)
    } else if (m.type === 'stopped') stopWaiter?.(m.result)
  })
  w.on('exit', (code) => {
    if (worker !== w) return
    worker = null
    if (stopWaiter) {
      stopWaiter(EMPTY) // exited while stopping without a result
      return
    }
    process.stdout.write(`senti sensing worker exited unexpectedly (code ${code})\n`)
    pushEvent({ status: { state: 'error', hint: '', ready: false, restarts: 0, message: CRASH_MESSAGE } })
  })
  post({ type: 'start', apiKey })
}

function setPhase(phase: SensingPhase, playStartedAtMs?: number): void {
  post({ type: 'phase', phase, playStartedAtMs })
}

async function stopSensing(): Promise<SensingResult> {
  const w = worker
  if (!w) return EMPTY
  const result = await new Promise<SensingResult>((resolve) => {
    const timer = setTimeout(() => resolve(EMPTY), STOP_TIMEOUT_MS)
    stopWaiter = (r) => {
      clearTimeout(timer)
      resolve(r)
    }
    w.postMessage({ type: 'stop' } satisfies ToWorker)
  })
  stopWaiter = null
  if (worker === w) worker = null
  setTimeout(() => w.kill(), 1500) // the worker exits by itself after replying; this is the backstop
  return result
}

async function selfTest(seconds: number): Promise<void> {
  const log = (m: string): void => void process.stdout.write(`${m}\n`)
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const t0 = Date.now()
  let last = ''
  onEventTap = (e) => {
    last = `state=${e.status.state} hint="${e.status.hint}" ready=${e.status.ready} restarts=${e.status.restarts}`
  }
  startSensing()
  const dbg = setInterval(() => log(`  [selftest] t=${Math.round((Date.now() - t0) / 1000)}s ${last} frames=${previewFrames}`), 2000)
  setPhase('check')
  await wait(Math.min(10_000, seconds * 500))
  const frames = previewFrames
  setPhase('play', Date.now())
  await wait(Math.max(1000, seconds * 1000 - (Date.now() - t0)))
  clearInterval(dbg)
  const out = await stopSensing()
  const r3 = (n: number): number => Math.round(n * 1000) / 1000
  if (process.env.SENTI_SENSING_DUMP) log('SENTI_SENSING_DUMP ' + JSON.stringify(out.samples.map((x) => [x.t, x.samples, x.headSpeedMax, x.talking])))
  log(
    'SENTI_SENSING_SELFTEST ' +
      JSON.stringify({
        samples: out.samples.length,
        faceSeconds: out.samples.filter((s) => s.face).length,
        restarts: out.restarts,
        maxHeadSpeedMax: r3(Math.max(0, ...out.samples.map((s) => s.headSpeedMax ?? 0))),
        talkingSeconds: out.samples.filter((s) => (s.talking ?? 0) > 0.5).length,
        previewFrames: frames,
        firstT: out.samples[0]?.t,
        lastT: out.samples.at(-1)?.t,
        worker: 'utilityProcess'
      })
  )
  app.quit()
}

/** Dev helper for SENTI_RECORD_SELFTEST: start sensing and resolve once the SDK reports running (or after maxMs). */
export async function devStartSensingUntilRunning(maxMs: number): Promise<string> {
  let state = 'starting'
  const prevTap = onEventTap
  onEventTap = (e) => {
    state = e.status.state
    prevTap?.(e)
  }
  startSensing()
  setPhase('baseline')
  const t0 = Date.now()
  while (state !== 'running' && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 250))
  return state
}
export const devStopSensing = (): Promise<SensingResult> => stopSensing()

/** Dev-only: fork the worker, have it load the SDK and list cameras (no session, no camera open), print, quit. */
function packageCheck(): void {
  const out = (o: unknown): void => void process.stdout.write('SENTI_PACKAGE_CHECK ' + JSON.stringify(o) + '\n')
  const w = utilityProcess.fork(join(__dirname, 'sensing-worker.js'), [], { serviceName: 'senti-package-check', env: workerEnv(), stdio: 'pipe' })
  const timer = setTimeout(() => {
    out({ ok: false, error: 'timeout' })
    w.kill()
    app.quit()
  }, 30_000)
  w.on('message', (m: FromWorker) => {
    if (m.type !== 'packageCheck') return
    clearTimeout(timer)
    done = true
    out({ ...m.info, worker: __dirname, packaged: app.isPackaged })
    w.kill()
    app.quit()
  })
  let err = ''
  let done = false
  w.stderr?.on('data', (d) => (err += String(d)))
  w.on('exit', (code) => {
    if (done) return
    clearTimeout(timer)
    out({ ok: false, error: `worker exited ${code}`, stderr: err.slice(0, 600) })
    app.quit()
  })
  w.postMessage({ type: 'packageCheck' } satisfies ToWorker)
}

export function registerSensing(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  ipcMain.handle(IPC.sensingStart, () => startSensing())
  ipcMain.handle(IPC.sensingPhase, (_e, p: SensingPhase, playStartedAtMs?: number) => setPhase(p, playStartedAtMs))
  ipcMain.handle(IPC.sensingStop, () => stopSensing())
  app.on('before-quit', () => {
    const w = worker
    worker = null
    w?.kill()
  })
  if (process.env.SENTI_PACKAGE_CHECK === '1') packageCheck()
  const st = Number(process.env.SENTI_SENSING_SELFTEST ?? 0)
  if (st > 0) void selfTest(st).catch((e) => process.stdout.write(`SENTI_SENSING_SELFTEST_ERROR ${String(e)}\n`))
}
