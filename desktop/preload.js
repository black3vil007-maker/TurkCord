const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: '1.0.13',
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  getMetrics: () => ipcRenderer.invoke('app:get-metrics'),
  getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('app:set-auto-launch', enable),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  installUpdate: (url) => ipcRenderer.invoke('app:auto-update-install', url),
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('app:update-progress', handler);
    return () => ipcRenderer.removeListener('app:update-progress', handler);
  }
});
