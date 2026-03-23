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
  isWayland: () => ipcRenderer.invoke('is-wayland'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onCaptureCommand: (callback) =>
    ipcRenderer.on('capture-command', (event, data) => callback(data)),
});

/**
 * @param {string} audioPath
 * @returns {void}
 */
const playAndDestroy = (audioPath) => {
  let audio = new Audio(audioPath);

  // Event listener to clean up memory after playback
  audio.addEventListener(
    'ended',
    () => {
      audio.pause();
      audio.src = ''; // Clear the source to help garbage collection
      audio.load();
      audio = null; // Remove the reference
    },
    { once: true },
  ); // 'once' ensures the listener is removed after firing

  audio.play().catch((error) => {
    ipcRenderer.send('console.log', `[Audio] [${audioPath}] Playback failed:`, error.message);
    audio = null;
  });
};

ipcRenderer.on('play-sound', (event, filePath) => playAndDestroy(filePath));
