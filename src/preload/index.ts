import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SentiApi } from '../shared/ipc'

// The SmartSpectra SDK preload (window.__smartspectraBridge) is registered separately by main via
// session.registerPreloadScript, because a sandboxed preload cannot require() it.
function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: SentiApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  saveRecording: (data) => ipcRenderer.invoke(IPC.saveRecording, data),
  spikeConfig: () => ipcRenderer.invoke(IPC.spikeConfig),
  spikeResult: (result) => ipcRenderer.invoke(IPC.spikeResult, result),
  sensorConfig: () => ipcRenderer.invoke(IPC.sensorConfig),
  sensorBegin: () => ipcRenderer.invoke(IPC.sensorBegin),
  sensorAppend: (id, lines) => ipcRenderer.invoke(IPC.sensorAppend, id, lines),
  sensorSummary: (id, summary) => ipcRenderer.invoke(IPC.sensorSummary, id, summary),

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
