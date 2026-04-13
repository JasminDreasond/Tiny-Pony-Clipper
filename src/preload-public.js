const { contextBridge, ipcRenderer } = require('electron');

/**
 * Initializes the secure context bridge for the public Remote Play client.
 *
 * @returns {void}
 */
const initializePublicAPI = () => {
  /**
   * @type {string}
   * The channel name used to notify the main process.
   */
  const readyChannel = 'remote-play-ready';

  // Notify the main process that the window is successfully loaded and ready
  ipcRenderer.send(readyChannel);

  // You can expose safe APIs to the window here in the future
  contextBridge.exposeInMainWorld('api', {
    /**
     * Logs a message securely from the renderer to the main process.
     *
     * @param {string} message - The message to log.
     * @returns {void}
     */
    log: (message) => ipcRenderer.send('console.log', `[Remote Play Client] ${message}`),
  });
};

initializePublicAPI();
