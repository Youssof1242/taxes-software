// MapleTax Canada — Electron desktop shell
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Renderer bridge: read bundled table files (fetch() is blocked on file://)
ipcMain.handle('read-bundled', (_e, rel) => {
  const safe = path.normalize(String(rel || '')).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(__dirname, safe);
  if (!full.startsWith(__dirname)) throw new Error('forbidden path');
  return fs.readFileSync(full, 'utf8');
});

// Renderer bridge: fetch official CRA pages (canada.ca has no CORS for
// browsers, so the desktop shell fetches server-side). Strict allowlist,
// https-only, size + time caps.
const FETCH_ALLOW = new Set(['www.canada.ca']);
ipcMain.handle('fetch-url', async (_e, url) => {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { throw new Error('bad URL'); }
  if (u.protocol !== 'https:' || !FETCH_ALLOW.has(u.hostname)) throw new Error('URL not allowed: ' + u.hostname);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MapleTax/1.0' },
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + u.hostname);
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 3000000) throw new Error('response too large');
    return Buffer.from(buf).toString('utf8');
  } finally { clearTimeout(t); }
});

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // Open external links (canada.ca etc.) in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'MapleTax',
      submenu: [
        { label: 'Print / Save PDF summary', accelerator: 'CmdOrCtrl+P', click: () => win.webContents.print({ printBackground: true }) },
        { type: 'separator' },
        { label: 'Reload app', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { type: 'separator' },
        { role: 'quit', label: 'Exit MapleTax' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { role: 'resetZoom', label: 'Reset zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full screen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'CRA — Tax rates and brackets', click: () => shell.openExternal('https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets.html') },
        { label: 'About MapleTax', click: () => dialog.showMessageBox(win, { type: 'info', title: 'MapleTax Canada', message: 'MapleTax Canada v1.0.0', detail: 'Offline 2024–2026 Canadian tax estimator.\nFederal + all provinces, CPP/QPP, EI, RRSP & credits.\nYour data never leaves this computer.' }) }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
