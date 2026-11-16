import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SentiApi } from '../shared/ipc'

const api: SentiApi = {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  selectSource: (id) => ipcRenderer.invoke(IPC.selectSource, id),
  saveRecording: (data) => ipcRenderer.invoke(IPC.saveRecording, data),
  spikeConfig: () => ipcRenderer.invoke(IPC.spikeConfig),
  spikeResult: (result) => ipcRenderer.invoke(IPC.spikeResult, result)
}

contextBridge.exposeInMainWorld('senti', api)
