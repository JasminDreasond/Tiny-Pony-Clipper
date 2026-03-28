/**
 * @returns {Promise<void>}
 */
const initApiBridge = async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.error('[API Bridge] Service Worker error:', error);
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    /** @type {Object} */
    const data = event.data;

    if (data && data.type === 'api_response') {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'tiny_pony_api_response',
            requestId: data.requestId,
            status: data.status,
            code: data.code,
            message: data.message,
          },
          data.origin,
        );
      }
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent) return;
    if (!event.data || typeof event.data !== 'object' || !event.data.action) return;

    /** @type {string} */
    const origin = event.origin;
    if (!origin || origin === 'null') return;

    try {
      /** @type {ServiceWorkerRegistration} */
      const reg = await navigator.serviceWorker.ready;

      if (reg && reg.active) {
        reg.active.postMessage({
          type: 'api_relay',
          origin: origin,
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
