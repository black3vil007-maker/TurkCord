const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: '1.0.11',
  getMetrics: () => ipcRenderer.invoke('app:get-metrics'),
  getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('app:set-auto-launch', enable),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text)
});
