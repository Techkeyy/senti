import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SentiApi } from '../shared/ipc'

// The SmartSpectra SDK preload (window.__smartspectraBridge) is registered separately by main via
// session.registerPreloadScript, because a sandboxed preload cannot require() it.
const api: SentiApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  saveRecording: (data) => ipcRenderer.invoke(IPC.saveRecording, data),
  spikeConfig: () => ipcRenderer.invoke(IPC.spikeConfig),
  spikeResult: (result) => ipcRenderer.invoke(IPC.spikeResult, result),
  sensorConfig: () => ipcRenderer.invoke(IPC.sensorConfig),
  sensorBegin: () => ipcRenderer.invoke(IPC.sensorBegin),
  sensorAppend: (id, lines) => ipcRenderer.invoke(IPC.sensorAppend, id, lines),
  sensorSummary: (id, summary) => ipcRenderer.invoke(IPC.sensorSummary, id, summary)
}

contextBridge.exposeInMainWorld('senti', api)
