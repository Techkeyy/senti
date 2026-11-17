import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { registerRecorder } from './recorder'
import { registerSettings } from './settings'
import { registerSensing } from './sensing'
import { registerSessions, registerSessionSchemes } from './sessions'
import { registerDev } from './dev'
import { IPC } from '../shared/ipc'

let mainWindow: BrowserWindow | null = null
/** Set by the renderer during play and saving; closing then asks first. */
let busy = false
const getWindow = (): BrowserWindow | null => mainWindow

registerSessionSchemes()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  mainWindow = win
  win.on('closed', () => (mainWindow = null))
  win.on('close', (e) => {
    if (!busy) return
    if (win.isMinimized()) win.restore()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep playing', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      message: 'A playtest is running. Close anyway? The recording will be lost.'
    })
    if (choice === 0) e.preventDefault()
  })
  win.webContents.on('console-message', (event) => {
    const msg = event.message
    if (typeof msg === 'string' && msg.startsWith('SENTI_')) process.stdout.write(msg + '\n')
  })
  win.on('ready-to-show', () => win.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// One Senti at a time (two would fight over the camera and the hotkeys). Dev self-tests (SENTI_* flags) skip the lock, in unpackaged builds only.
const isDevRun = !app.isPackaged && Object.keys(process.env).some((k) => k.startsWith('SENTI_'))
const gotLock = isDevRun || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = mainWindow
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null) // no menu bar, no Reload or DevTools shortcuts
    ipcMain.handle(IPC.windowSetBusy, (_e, b: unknown) => {
      busy = b === true
    })
    registerRecorder(getWindow)
    registerSettings()
    registerSensing(getWindow)
    registerSessions(getWindow)
    registerDev(getWindow)

    createWindow()
  })
}

app.on('window-all-closed', () => app.quit())
