/** @type {HTMLInputElement} */
const targetUrlInput = document.getElementById('targetUrl');
/** @type {HTMLInputElement} */
const hostIpInput = document.getElementById('hostIp');
/** @type {HTMLInputElement} */
const hostPassInput = document.getElementById('hostPass');
/** @type {HTMLButtonElement} */
const btnSend = document.getElementById('btnSend');
/** @type {HTMLElement} */
const iframeContainer = document.getElementById('iframeContainer');

/**
 * @param {string} baseUrl
 * @returns {Promise<HTMLIFrameElement>}
 */
const loadApiIframe = (baseUrl) => {
  return new Promise((resolve) => {
    /** @type {HTMLIFrameElement} */
    const iframe = document.createElement('iframe');
    /** @type {string} */
    const apiPath = `${baseUrl}/api.html`;

    iframe.src = apiPath;
    iframe.onload = () => resolve(iframe);

    iframeContainer.innerHTML = '';
    iframeContainer.appendChild(iframe);
  });
};

/**
 * @param {string} expectedOrigin
 * @returns {Promise<void>}
 */
const waitForApiReady = (expectedOrigin) => {
  return new Promise((resolve) => {
    /**
     * @param {MessageEvent} event
     * @returns {void}
     */
    const messageHandler = (event) => {
      /** @type {string} */
      const origin = event.origin;
      /** @type {Object} */
      const data = event.data;

      if (origin === expectedOrigin && data?.type === 'tiny_pony_api_ready') {
        window.removeEventListener('message', messageHandler);
        resolve();
      }
    };

    window.addEventListener('message', messageHandler);
  });
};

btnSend.addEventListener('click', async () => {
  /** @type {string} */
  const targetUrl = targetUrlInput.value.replace(/\/$/, '');
  /** @type {string} */
  const host = hostIpInput.value;
  /** @type {string} */
  const pass = hostPassInput.value;

  window.addEventListener('message', (event) => {
    /** @type {string} */
    const origin = event.origin;
    /** @type {Object} */
    const data = event.data;

    if (origin === targetUrl && data?.type === 'tiny_pony_api_response') {
      console.log(`[TEST APP] API Response`, data);
    }
  });

  console.log(`[TEST APP] Loading iframe from ${targetUrl}...`);

  /** @type {Promise<HTMLIFrameElement>} */
  const iframeLoadPromise = loadApiIframe(targetUrl);
  /** @type {Promise<void>} */
  const apiReadyPromise = waitForApiReady(targetUrl);

  // We wait for both: the iframe DOM load and the ready signal
  /** @type {[HTMLIFrameElement, void]} */
  const [apiIframe] = await Promise.all([iframeLoadPromise, apiReadyPromise]);

  /** @type {Object} */
  const payload = {
    action: 'connect_ip',
    requestId: String(Math.random()),
    host: host,
    pass: pass,
  };

  console.log('[TEST APP] API is ready. Sending message:', payload);

  if (apiIframe.contentWindow) {
    apiIframe.contentWindow.postMessage(payload, targetUrl);
  }
});
