const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evacuationDesktop', {
  saveProject: project => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  choosePdf: () => ipcRenderer.invoke('file:pdf'),
  openExternal: filePath => ipcRenderer.invoke('file:openExternal', filePath),
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  readFile: filePath => ipcRenderer.invoke('file:read', filePath),
  statFile: filePath => ipcRenderer.invoke('file:stat', filePath),
  saveBinary: payload => ipcRenderer.invoke('file:saveBinary', payload),
  exportPdf: payload => ipcRenderer.invoke('export:pdf', payload)
});
