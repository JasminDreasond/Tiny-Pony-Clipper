const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  log: (...args) => ipcRenderer.send('console.log', ...args),
  error: (...args) => console.error(...args),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  sendVideoChunk: (chunk) => ipcRenderer.send('video-chunk', chunk),
  startSegment: (timestamp) => ipcRenderer.send('start-segment', timestamp),
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  onCaptureCommand: (callback) =>
    ipcRenderer.on('capture-command', (event, data) => callback(data)),
});
