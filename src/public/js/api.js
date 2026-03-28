/**
 * @returns {Promise<void>}
 */
const initApiBridge = async () => {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js');
  }

  window.addEventListener('message', (event) => {
    /** @type {MessagePort | null} */
    const sourcePort = event.ports ? event.ports[0] : null;

    if (!navigator.serviceWorker.controller) {
      if (sourcePort) {
        sourcePort.postMessage({ status: 'error', message: 'Service Worker not ready' });
      }
      return;
    }

    navigator.serviceWorker.controller.postMessage({
      type: 'api_relay',
      origin: event.origin,
      payload: event.data,
    });
  });
};

initApiBridge();
