const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getBackendUrl: () => ipcRenderer.invoke('backend:getUrl'),
  backendStatus: () => ipcRenderer.invoke('backend:status'),
  stopBackend: () => ipcRenderer.invoke('backend:stop')
})
