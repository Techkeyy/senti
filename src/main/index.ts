import { app, BrowserWindow, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { registerRecorder } from './recorder'

const autotest = process.env.SENTI_SPIKE_AUTOTEST === '1'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false
    }
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

  ipcMain.handle(IPC.spikeConfig, () => ({ autotest }))
  ipcMain.handle(IPC.spikeResult, (_e, result: unknown) => {
    writeFileSync(join(app.getPath('userData'), 'spike-result.json'), JSON.stringify(result, null, 2))
    process.stdout.write(`SENTI_SPIKE_RESULT ${JSON.stringify(result)}\n`)
    if (autotest) app.quit()
  })

  createWindow()
})

app.on('window-all-closed', () => app.quit())
