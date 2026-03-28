/**
 * @param {string} originUrl
 * @returns {boolean}
 */
const isOriginSecure = (originUrl) => {
  try {
    /** @type {URL} */
    const url = new URL(originUrl);
    return (
      url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    );
  } catch (e) {
    return false;
  }
};

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

    /** @type {Object} */
    const payload = event.data;
    if (!payload || typeof payload !== 'object' || !payload.action || !payload.requestId) return;

    /** @type {string} */
    const origin = event.origin;
    if (!origin || origin === 'null') return;

    if (!isOriginSecure(origin)) {
      console.warn('[API Bridge] Rejected insecure origin:', origin);
      window.parent.postMessage(
        {
          type: 'tiny_pony_api_response',
          requestId: payload.requestId,
          status: 'error',
          code: 'ERR_INSECURE_ORIGIN',
          message: 'Only HTTPS or localhost origins are allowed.',
        },
        origin,
      );
      return;
    }

    try {
      /** @type {ServiceWorkerRegistration} */
      const reg = await navigator.serviceWorker.ready;

      if (reg && reg.active) {
        reg.active.postMessage({
          type: 'api_relay',
          origin: origin,
          payload: payload,
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
