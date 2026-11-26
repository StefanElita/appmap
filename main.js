const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.xml': 'application/xml',
  '.csv': 'text/csv'
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1120, minHeight: 720,
    backgroundColor: '#0b1220', title: 'Evacuation Simulator 0.10.0',
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

ipcMain.handle('file:pick', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Прикачи файлове към проекта',
      properties: ['openFile', 'multiSelections']
    });
    if (canceled || !filePaths.length) return { canceled: true, files: [] };
    const files = [];
    for (const filePath of filePaths) {
      let size = 0;
      try {
        const stat = await fs.stat(filePath);
        size = stat.size;
      } catch (_) { /* keep 0 */ }
      files.push({
        path: filePath,
        name: path.basename(filePath),
        ext: path.extname(filePath).replace('.', '').toLowerCase(),
        size
      });
    }
    return { canceled: false, files };
  } catch (error) {
    return { canceled: true, files: [], error: error.message };
  }
});

ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'Липсва път до файла.' };
    const buffer = await fs.readFile(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      size: buffer.length,
      dataUrl: 'data:' + mimeFor(filePath) + ';base64,' + buffer.toString('base64')
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:stat', async (_event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath) return { exists: false };
    const stat = await fs.stat(filePath);
    return { exists: stat.isFile(), size: stat.size };
  } catch (_) {
    return { exists: false };
  }
});

ipcMain.handle('file:saveBinary', async (_event, payload) => {
  try {
    const data = payload || {};
    const base64 = typeof data.base64 === 'string' ? data.base64 : '';
    if (!base64) return { canceled: false, error: 'Няма данни за запис.' };
    const filters = Array.isArray(data.filters) && data.filters.length
      ? data.filters
      : [{ name: 'Всички файлове', extensions: ['*'] }];
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Експортирай файл',
      defaultPath: data.defaultName || 'export.bin',
      filters
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
    return { canceled: false, filePath };
  } catch (error) {
    return { canceled: false, error: error.message };
  }
});

ipcMain.handle('export:pdf', async (event, payload) => {
  try {
    const data = payload || {};
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { canceled: false, error: 'Прозорецът не е достъпен.' };
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Запази PDF отчет',
      defaultPath: data.defaultName || 'evacuation_report.pdf',
      filters: [{ name: 'PDF документ', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, pdf);
    return { canceled: false, filePath };
  } catch (error) {
    return { canceled: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
