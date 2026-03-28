/** @type {HTMLInputElement} */
const targetUrlInput = document.getElementById('targetUrl');
/** @type {HTMLInputElement} */
const hostIpInput = document.getElementById('hostIp');
/** @type {HTMLInputElement} */
const hostPassInput = document.getElementById('hostPass');
/** @type {HTMLButtonElement} */
const btnSendIp = document.getElementById('btnSendIp');

// SDP Elements
/** @type {HTMLButtonElement} */
const btnGenerateOffer = document.getElementById('btnGenerateOffer');
/** @type {HTMLTextAreaElement} */
const sdpAnswerInput = document.getElementById('sdpAnswer');
/** @type {HTMLButtonElement} */
const btnConnectSdp = document.getElementById('btnConnectSdp');

/** @type {HTMLElement} */
const iframeContainer = document.getElementById('iframeContainer');

// Modal Elements
/** @type {HTMLElement} */
const modal = document.getElementById('responseModal');
/** @type {HTMLElement} */
const responseOutput = document.getElementById('responseOutput');
/** @type {HTMLButtonElement} */
const btnCloseModal = document.getElementById('btnCloseModal');
/** @type {HTMLButtonElement} */
const btnClearModal = document.getElementById('btnClearModal');

/** @type {HTMLIFrameElement|null} */
let currentIframe = null;
/** @type {string} */
let lastTargetUrl = '';

/**
 * @param {Object} data
 */
const showResponseModal = (data) => {
  responseOutput.textContent = JSON.stringify(data, null, 2);
  modal.classList.add('active');
};

/**
 * @returns {void}
 */
const closeModal = () => {
  modal.classList.remove('active');
};

btnCloseModal.addEventListener('click', closeModal);
btnClearModal.addEventListener('click', closeModal);

// Close on escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

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
    showResponseModal(data);
  }
};

// We register the response listener only once here
window.addEventListener('message', handleApiResponse);

/**
 * Core function to ensure the API iframe is ready before sending a payload.
 * @returns {Promise<void>}
 */
const ensureIframeReady = async () => {
  /** @type {string} */
  const targetUrl = targetUrlInput.value.replace(/\/$/, '');

  // Check if we need to reload the iframe
  if (targetUrl !== lastTargetUrl || !currentIframe) {
    console.log(`[TEST APP] Loading API iframe from ${targetUrl}...`);

    /** @type {Promise<HTMLIFrameElement>} */
    const iframeLoadPromise = loadApiIframe(targetUrl);
    /** @type {Promise<void>} */
    const apiReadyPromise = waitForApiReady(targetUrl);

    /** @type {[HTMLIFrameElement, void]} */
    const [newIframe] = await Promise.all([iframeLoadPromise, apiReadyPromise]);

    currentIframe = newIframe;
    lastTargetUrl = targetUrl;
  }
};

/**
 * @param {Object} payload
 * @returns {void}
 */
const sendPayload = (payload) => {
  console.log('[TEST APP] Sending message:', payload);
  if (currentIframe && currentIframe.contentWindow) {
    currentIframe.contentWindow.postMessage(payload, lastTargetUrl);
  }
};

// --- BUTTON LISTENERS ---

btnSendIp.addEventListener('click', async () => {
  await ensureIframeReady();

  /** @type {Object} */
  const payload = {
    action: 'connect_ip',
    requestId: String(Math.random()),
    host: hostIpInput.value,
    pass: hostPassInput.value,
  };

  sendPayload(payload);
});

btnGenerateOffer.addEventListener('click', async () => {
  await ensureIframeReady();

  /** @type {Object} */
  const payload = {
    action: 'generate_offer',
    requestId: String(Math.random()),
  };

  sendPayload(payload);
});

btnConnectSdp.addEventListener('click', async () => {
  await ensureIframeReady();

  /** @type {Object} */
  const payload = {
    action: 'connect_sdp',
    requestId: String(Math.random()),
    answer: sdpAnswerInput.value,
  };

  sendPayload(payload);
});
