/** @type {MessagePort | null} */
let apiPort = null;
/** @type {string | null} */
let connectedOrigin = null;

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

    if (data && data.type === 'api_response' && apiPort && connectedOrigin === data.origin) {
      apiPort.postMessage({
        type: 'tiny_pony_api_response',
        requestId: data.requestId,
        status: data.status,
        code: data.code,
        message: data.message,
        data: data.data,
      });
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent) return;

    /** @type {Object} */
    const payload = event.data;

    if (payload && payload.type === 'init_tiny_pony_api') {
      /** @type {string} */
      const origin = event.origin;

      if (!origin || origin === 'null') return;

      if (!isOriginSecure(origin)) {
        console.warn('[API Bridge] Rejected insecure origin:', origin);
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({
            type: 'tiny_pony_api_response',
            status: 'error',
            code: 'ERR_INSECURE_ORIGIN',
            message: 'Only HTTPS or localhost origins are allowed.',
          });
        }
        return;
      }

      if (event.ports && event.ports.length > 0) {
        apiPort = event.ports[0];
        connectedOrigin = origin;

        apiPort.onmessage = async (portEvent) => {
          /** @type {Object} */
          const portPayload = portEvent.data;
          if (
            !portPayload ||
            typeof portPayload !== 'object' ||
            !portPayload.action ||
            !portPayload.requestId
          )
            return;

          try {
            /** @type {ServiceWorkerRegistration} */
            const reg = await navigator.serviceWorker.ready;

            if (reg && reg.active) {
              reg.active.postMessage({
                type: 'api_relay',
                origin: connectedOrigin,
                payload: portPayload,
              });
            }
          } catch (err) {
            console.error('[API Bridge] Message routing failed:', err);
          }
        };

        apiPort.postMessage({ type: 'tiny_pony_api_ready' });
      }
    }
  });

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'tiny_pony_iframe_loaded' }, '*');
  }
};

initApiBridge();
