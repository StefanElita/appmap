const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('evacuationDesktop', {
  saveProject: project => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  choosePdf: () => ipcRenderer.invoke('file:pdf'),
  openExternal: filePath => ipcRenderer.invoke('file:openExternal', filePath)
});
