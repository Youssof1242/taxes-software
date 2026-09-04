// Preload: sandboxed bridge — lets the updater read bundled table files
// (fetch() is blocked under file:// in Electron) and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mapleTax', {
  readBundled: (rel) => ipcRenderer.invoke('read-bundled', rel),
  fetchText: (url) => ipcRenderer.invoke('fetch-url', url),
  isDesktop: true
});

window.addEventListener('DOMContentLoaded', () => {
  document.title = document.title || 'MapleTax Canada';
});
