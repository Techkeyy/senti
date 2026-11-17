import { BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron'
import { IPC } from '../shared/ipc'

export function registerRecorder(getWindow: () => BrowserWindow | null): void {
  // The renderer calls getDisplayMedia(); this handler grants the primary screen directly (no picker).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      const primary = String(screen.getPrimaryDisplay().id)
      const source = sources.find((s) => s.display_id === primary) ?? sources.find((s) => s.id === 'screen:0:0') ?? sources[0]
      if (!source) {
        callback({})
        return
      }
      callback({ video: source })
    } catch {
      callback({})
    }
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  // Senti steps aside while the player plays, then comes back for Saving and the Report.
  ipcMain.handle(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.handle(IPC.windowRestore, () => {
    const w = getWindow()
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  })
}
