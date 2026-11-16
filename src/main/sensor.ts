import { app, ipcMain, session, type BrowserWindow } from 'electron'
import { appendFile, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main'
import { IPC, type SensorConfig, type SensorRun } from '../shared/ipc'

// Dev only: the key comes from probe/.env until in-app key entry exists. Never logged.
function loadDevKey(): string {
  if (!process.env.SENTI_PRESAGE_KEY) {
    for (const p of [join(app.getAppPath(), 'probe', '.env'), join(process.cwd(), 'probe', '.env')]) {
      try {
        process.loadEnvFile(p)
        break
      } catch {
        /* try next */
      }
    }
  }
  return (process.env.SENTI_PRESAGE_KEY ?? '').trim()
}

const runs = new Map<string, SensorRun>()

/** Call once at app ready, before any window is created: registers the SDK preload and the IPC handlers. */
export function registerSensor(): void {
  // Sandboxed preloads cannot require() the SDK preload, so it is registered as a second frame preload.
  // It exposes window.__smartspectraBridge; our own preload (window.senti) stays the window's preload.
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: require.resolve('@smartspectra/node-sdk/preload')
  })

  ipcMain.handle(
    IPC.sensorConfig,
    (): SensorConfig => ({
      apiKey: loadDevKey(),
      plan: process.env.SENTI_SENSOR_TEST ?? '',
      forceRebuild: process.env.SENTI_SENSOR_FORCE_REBUILD === '1',
      autoQuit: process.env.SENTI_SENSOR_AUTOQUIT === '1',
      resolution: process.env.SENTI_SENSOR_RES ?? ''
    })
  )

  ipcMain.handle(IPC.sensorBegin, async (): Promise<SensorRun> => {
    const dir = join(app.getPath('userData'), 'sensor-tests')
    await mkdir(dir, { recursive: true })
    const id = new Date().toISOString().replace(/[:.]/g, '-')
    const run = { id, logPath: join(dir, `${id}.jsonl`) }
    await writeFile(run.logPath, '')
    runs.set(id, run)
    return run
  })

  ipcMain.handle(IPC.sensorAppend, async (_e, id: string, lines: string) => {
    const run = runs.get(id)
    if (run) await appendFile(run.logPath, lines)
  })

  ipcMain.handle(IPC.sensorSummary, async (_e, id: string, summary: unknown) => {
    const run = runs.get(id)
    if (!run) throw new Error('unknown sensor run')
    const path = run.logPath.replace(/\.jsonl$/, '.summary.json')
    await writeFile(path, JSON.stringify(summary, null, 2))
    process.stdout.write(`SENTI_SENSOR_RESULT ${path}\n`)
    if (process.env.SENTI_SENSOR_AUTOQUIT === '1') setTimeout(() => app.exit(0), 1500)
    return path
  })
}

export function bindSensor(win: BrowserWindow): void {
  bindSmartSpectraIpc(win)
}
