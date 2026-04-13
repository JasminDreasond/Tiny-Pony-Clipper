const { contextBridge, ipcRenderer } = require('electron');

/**
 * Initializes the secure context bridge and direct API IPC for the public Remote Play client.
 *
 * @returns {void}
 */
const initializePublicAPI = () => {
  /**
   * @type {string}
   * The channel name used to notify the main process.
   */
  const readyChannel = 'remote-play-ready';

  // Notify the main process that the window is successfully loaded
  ipcRenderer.send(readyChannel);

  // Expose safe logging
  contextBridge.exposeInMainWorld('api', {
    /**
     * Logs a message securely from the renderer to the main process.
     *
     * @param {string} message - The message to log.
     * @returns {void}
     */
    log: (message) => ipcRenderer.send('console.log', `[Remote Play Client] ${message}`),
  });

  // --- INTERNAL API BRIDGE (Acts as Service Worker Replacement) ---

  // 1. Receive Request from the Main Process (CLI)
  ipcRenderer.on('dispatch-api-request', (event, payload) => {
    // Post directly to the window (PageApi.js will catch this)
    window.postMessage(
      {
        type: 'api_request',
        origin: 'Local System (CLI)', // Secure identifier
        payload: payload,
      },
      '*',
    );
  });

  // 2. Listen for Responses from the Window (PageApi.js) and send back to Main Process
  window.addEventListener('message', (event) => {
    // Ensure the message is strictly from our own window
    if (event.source !== window) return;

    /** @type {Object} */
    const data = event.data;

    if (data && data.type === 'api_response' && data.origin === 'Local System (CLI)') {
      ipcRenderer.send('api-response-from-client', data);
    }
  });
};

initializePublicAPI();
