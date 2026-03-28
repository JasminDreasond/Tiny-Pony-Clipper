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

/** @type {HTMLIFrameElement|null} */
let currentIframe = null;
/** @type {string} */
let lastTargetUrl = '';

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

/**
 * @param {MessageEvent} event
 * @returns {void}
 */
const handleApiResponse = (event) => {
  /** @type {Object} */
  const data = event.data;
  /** @type {string} */
  const currentTargetUrl = targetUrlInput.value.replace(/\/$/, '');

  // We check the origin and the message type to ensure it's the correct response
  if (event.origin === currentTargetUrl && data?.type === 'tiny_pony_api_response') {
    console.log(`[TEST APP] API Response`, data);
  }
};

// We register the response listener only once here
window.addEventListener('message', handleApiResponse);

btnSend.addEventListener('click', async () => {
  /** @type {string} */
  const targetUrl = targetUrlInput.value.replace(/\/$/, '');
  /** @type {string} */
  const host = hostIpInput.value;
  /** @type {string} */
  const pass = hostPassInput.value;

  // Check if we need to reload the iframe
  if (targetUrl !== lastTargetUrl || !currentIframe) {
    console.log(`[TEST APP] Target changed or missing. Loading iframe from ${targetUrl}...`);

    /** @type {Promise<HTMLIFrameElement>} */
    const iframeLoadPromise = loadApiIframe(targetUrl);
    /** @type {Promise<void>} */
    const apiReadyPromise = waitForApiReady(targetUrl);

    /** @type {[HTMLIFrameElement, void]} */
    const [newIframe] = await Promise.all([iframeLoadPromise, apiReadyPromise]);

    currentIframe = newIframe;
    lastTargetUrl = targetUrl;
  } else {
    console.log(`[TEST APP] Reusing existing iframe for ${targetUrl}`);
  }

  /** @type {Object} */
  const payload = {
    action: 'connect_ip',
    requestId: String(Math.random()),
    host: host,
    pass: pass,
  };

  console.log('[TEST APP] Sending message:', payload);

  if (currentIframe && currentIframe.contentWindow) {
    currentIframe.contentWindow.postMessage(payload, targetUrl);
  }
});
