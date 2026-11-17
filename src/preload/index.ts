import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SentiApi } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: SentiApi = {
  windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  windowRestore: () => ipcRenderer.invoke(IPC.windowRestore),

  keyStatus: () => ipcRenderer.invoke(IPC.keyStatus),
  keySet: (key) => ipcRenderer.invoke(IPC.keySet, key),
  keyClear: () => ipcRenderer.invoke(IPC.keyClear),
  sensingStart: () => ipcRenderer.invoke(IPC.sensingStart),
  sensingPhase: (phase, playStartedAtMs) => ipcRenderer.invoke(IPC.sensingPhase, phase, playStartedAtMs),
  sensingStop: () => ipcRenderer.invoke(IPC.sensingStop),
  onSensingEvent: (cb) => subscribe(IPC.sensingEvent, cb),
  onPreview: (cb) => subscribe(IPC.sensingPreview, cb),
  sessionsList: () => ipcRenderer.invoke(IPC.sessionsList),
  sessionsGet: (id) => ipcRenderer.invoke(IPC.sessionsGet, id),
  sessionsSave: (session, recording) => ipcRenderer.invoke(IPC.sessionsSave, session, recording),
  sessionsDelete: (id) => ipcRenderer.invoke(IPC.sessionsDelete, id),
  sessionVideoUrl: (id) => `senti-media://session/${encodeURIComponent(id)}`,
  hotkeysEnable: (on) => ipcRenderer.invoke(IPC.hotkeysEnable, on),
  onHotkey: (cb) => subscribe(IPC.hotkey, cb)
}

contextBridge.exposeInMainWorld('senti', api)
