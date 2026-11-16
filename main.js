const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1120, minHeight: 720,
    backgroundColor: '#0b1220', title: 'Evacuation Simulator 0.2',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}
ipcMain.handle('project:save', async (_event, project) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Запази проект', defaultPath: 'evacuation-project.evac.json',
    filters: [{ name: 'Evacuation Simulator project', extensions: ['json', 'evac'] }]
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, JSON.stringify(project, null, 2), 'utf8');
  return { canceled: false, filePath };
});
ipcMain.handle('project:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Evacuation Simulator project', extensions: ['json', 'evac'] }] });
  if (canceled || !filePaths[0]) return { canceled: true };
  const raw = await fs.readFile(filePaths[0], 'utf8');
  const project = JSON.parse(raw);
  if (!project || project.format !== 'evacuation-simulator' || !Array.isArray(project.floors)) throw new Error('Невалиден файл на проект.');
  return { canceled: false, project, filePath: filePaths[0] };
});
ipcMain.handle('file:pdf', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF план', extensions: ['pdf'] }] });
  return canceled || !filePaths[0] ? { canceled: true } : { canceled: false, filePath: filePaths[0] };
});
ipcMain.handle('file:openExternal', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return 'Липсва път до файла.';
  return shell.openPath(filePath);
});
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
