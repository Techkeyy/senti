// Dev-only flags (never active for end users):
//   SENTI_RECORD_SELFTEST=1  start sensing in the worker, wait for 'running' (max 25 s), then run the real
//                            startRecording() path in the renderer for 10 s and print SENTI_RECORD_SELFTEST {...}
//   SENTI_SHOTS_READY=<dir>  save screenshots of the new-playtest and Ready screens
import { app, type BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { devStartSensingUntilRunning, devStopSensing } from './sensing'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function waitWindow(getWindow: () => BrowserWindow | null): Promise<BrowserWindow | null> {
  let win = getWindow()
  for (let i = 0; i < 100 && !win; i++) {
    await sleep(100)
    win = getWindow()
  }
  return win
}

async function recordSelfTest(getWindow: () => BrowserWindow | null): Promise<void> {
  const win = await waitWindow(getWindow)
  if (!win) return
  await sleep(2500)
  const t0 = Date.now()
  const state = await devStartSensingUntilRunning(25_000)
  process.stdout.write(`SENTI_RECORD_SELFTEST_INFO sdkState=${state} afterMs=${Date.now() - t0}\n`)
  win.webContents.on('console-message', (e) => {
    if (typeof e.message === 'string' && e.message.startsWith('SENTI_RECORD_SELFTEST ')) {
      void devStopSensing().then(() => app.quit())
    }
  })
  await win.webContents.executeJavaScript(`location.hash = '#dev-recordtest'`)
  await sleep(45_000)
  app.quit()
}

async function readyShots(getWindow: () => BrowserWindow | null, dir: string): Promise<void> {
  const win = await waitWindow(getWindow)
  if (!win) return
  await mkdir(dir, { recursive: true })
  await sleep(2500)
  for (const [name, hash] of [['new', '#dev-new'], ['ready', '#dev-ready']]) {
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`)
    await sleep(1800)
    await writeFile(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    process.stdout.write(`SENTI_SHOT ${name}\n`)
  }
  app.quit()
}

export function registerDev(getWindow: () => BrowserWindow | null): void {
  if (process.env.SENTI_RECORD_SELFTEST === '1') void recordSelfTest(getWindow)
  if (process.env.SENTI_SHOTS_READY) void readyShots(getWindow, process.env.SENTI_SHOTS_READY)
}
