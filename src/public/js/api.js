/**
 * @returns {Promise<void>}
 */
const initApiBridge = async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.error('[API Bridge] Service Worker error:', error);
  }

  window.addEventListener('message', async (event) => {
    if (!event.data || typeof event.data !== 'object' || !event.data.action) return;

    try {
      /** @type {ServiceWorkerRegistration} */
      const reg = await navigator.serviceWorker.ready;

      if (reg && reg.active) {
        reg.active.postMessage({
          type: 'api_relay',
          origin: event.origin,
          payload: event.data,
        });
      }
    } catch (err) {
      console.error('[API Bridge] Message routing failed:', err);
    }
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'tiny_pony_api_ready' }, '*');
  }
};

initApiBridge();
