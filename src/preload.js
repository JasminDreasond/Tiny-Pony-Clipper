const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  log: (...args) => ipcRenderer.send('console.log', ...args),
  error: (...args) =>
    ipcRenderer.send(
      'console.error',
      ...args.map((err) => (err instanceof Error ? err.message : err)),
    ),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  sendVideoChunk: (chunk) => ipcRenderer.send('video-chunk', chunk),
  startSegment: (timestamp) => ipcRenderer.send('start-segment', timestamp),
  sendSignal: (data) => ipcRenderer.send('webrtc-signal-back', data),
  onSignal: (callback) => ipcRenderer.on('webrtc-signal', (event, data) => callback(data)),
  onManualOffer: (callback) => ipcRenderer.on('webrtc-manual-offer', callback),
  sendManualAnswer: (answerString) => ipcRenderer.send('relay-manual-answer', answerString),
  sendManualOffer: (offerString) => ipcRenderer.send('process-manual-offer', offerString),
  onManualAnswer: (callback) => ipcRenderer.on('webrtc-manual-answer', callback),
  sendGamepadInput: (data) => ipcRenderer.send('gamepad-input', data),
  getGamepadStatus: () => ipcRenderer.invoke('get-gamepad-status'),
  getHardware: () => ipcRenderer.invoke('get-hardware'),
  isWayland: () => ipcRenderer.invoke('is-wayland'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  sendGamepadCleanup: (clientId) => ipcRenderer.send('gamepad-cleanup', clientId),
  notifyClientConnected: (clientId) => ipcRenderer.send('webrtc-client-connected', clientId),
  notifyClientDisconnected: (clientId) => ipcRenderer.send('webrtc-client-disconnected', clientId),
  kickClient: (clientId) => ipcRenderer.send('kick-client-request', clientId),
  onSendDatachannelMessage: (callback) => ipcRenderer.on('send-datachannel-message', callback),
  onClientListUpdate: (callback) => ipcRenderer.on('update-client-list', callback),
  onForceCloseWebrtc: (callback) => ipcRenderer.on('force-close-webrtc', callback),
  onCaptureCommand: (callback) =>
    ipcRenderer.on('capture-command', (event, data) => callback(data)),
  // Auth & Permissions APIs
  getAuthList: () => ipcRenderer.invoke('get-auth-list'),
  updateAuth: (caller, isAllowed) => ipcRenderer.invoke('update-auth', caller, isAllowed),
  deleteAuth: (caller) => ipcRenderer.invoke('delete-auth', caller),
  onAuthRequest: (callback) => ipcRenderer.on('auth-request', (event, caller) => callback(caller)),
  sendAuthResponse: (data) => ipcRenderer.send('auth-response', data),
});

/**
 * Plays an audio file from a given path and ensures the memory is cleaned up after playback.
 * Removes event listeners and clears the audio reference to assist garbage collection.
 *
 * @param {string} audioPath - The absolute file path to the audio file.
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
