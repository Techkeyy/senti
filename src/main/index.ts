import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerRecorder } from './recorder'
import { registerSettings } from './settings'
import { registerSensing } from './sensing'
import { registerSessions, registerSessionSchemes } from './sessions'

let mainWindow: BrowserWindow | null = null
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
  win.webContents.on('console-message', (event) => {
    const msg = event.message
    if (typeof msg === 'string' && msg.startsWith('SENTI_')) process.stdout.write(msg + '\n')
  })
  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerRecorder()
  registerSettings()
  registerSensing(getWindow)
  registerSessions(getWindow)


  createWindow()
})

app.on('window-all-closed', () => app.quit())
