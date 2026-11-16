import { app, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'

// The user's own Presage API key, encrypted at rest with the OS keychain (Electron safeStorage).
// Never logged, never sent to the renderer. Dev fallback: probe/.env (SENTI_PRESAGE_KEY).
const keyFile = (): string => join(app.getPath('userData'), 'presage-key.bin')

export function getApiKey(): string {
  try {
    if (existsSync(keyFile())) return safeStorage.decryptString(readFileSync(keyFile())).trim()
  } catch {
    /* unreadable: treat as missing */
  }
  if (!app.isPackaged) {
    for (const p of [join(app.getAppPath(), 'probe', '.env'), join(process.cwd(), 'probe', '.env')]) {
      try {
        process.loadEnvFile(p)
        break
      } catch {
        /* try next */
      }
    }
    return (process.env.SENTI_PRESAGE_KEY ?? '').trim()
  }
  return ''
}

export function registerSettings(): void {
  ipcMain.handle(IPC.keyStatus, () => ({ hasKey: getApiKey().length > 0 }))
  ipcMain.handle(IPC.keySet, (_e, key: string) => {
    const k = String(key ?? '').trim()
    if (k.length < 20) throw new Error('That does not look like a Presage API key.')
    writeFileSync(keyFile(), safeStorage.encryptString(k))
    return { hasKey: true }
  })
  ipcMain.handle(IPC.keyClear, () => {
    rmSync(keyFile(), { force: true })
    return { hasKey: getApiKey().length > 0 }
  })
}
