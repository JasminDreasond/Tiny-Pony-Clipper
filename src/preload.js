import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
    applySettings: (config) => ipcRenderer.send('apply-settings', config)
});