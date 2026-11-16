import { desktopCapturer, ipcMain, session } from 'electron'
import { IPC, type CaptureSource } from '../shared/ipc'

let selectedSourceId: string | null = null

export async function listSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 240, height: 135 }
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL()
  }))
}

export function registerRecorder(): void {
  // The renderer calls getDisplayMedia(); this handler grants the source chosen via IPC.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
    const source = sources.find((s) => s.id === selectedSourceId)
    if (!source) {
      callback({})
      return
    }
    callback({ video: source })
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  ipcMain.handle(IPC.listSources, () => listSources())
  ipcMain.handle(IPC.selectSource, (_e, id: string) => {
    selectedSourceId = id
  })
}
