const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  sendVideoChunk: (chunk) => ipcRenderer.send('video-chunk', chunk),
  onCaptureCommand: (callback) =>
    ipcRenderer.on('capture-command', (event, data) => callback(data)),
});
