/** @type {HTMLInputElement} */
const targetUrlInput = document.getElementById('targetUrl');
/** @type {HTMLInputElement} */
const hostIpInput = document.getElementById('hostIp');
/** @type {HTMLInputElement} */
const hostPassInput = document.getElementById('hostPass');
/** @type {HTMLButtonElement} */
const btnSendIp = document.getElementById('btnSendIp');

/** @type {HTMLButtonElement} */
const btnCheckStatus = document.getElementById('btnCheckStatus');

/** @type {HTMLButtonElement} */
const btnPingClient = document.getElementById('btnPingClient');

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
/** @type {MessagePort|null} */
let apiPort = null;

/**
 * @param {Object} data
 * @returns {void}
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
    iframe.src = `${baseUrl}/api.html`;

    /**
     * @param {MessageEvent} event
     * @returns {void}
     */
    const loadHandler = (event) => {
      if (event.origin === baseUrl && event.data?.type === 'tiny_pony_iframe_loaded') {
        window.removeEventListener('message', loadHandler);
        resolve(iframe);
      }
    };

    window.addEventListener('message', loadHandler);

    iframeContainer.innerHTML = '';
    iframeContainer.appendChild(iframe);
  });
};

/**
 * @param {HTMLIFrameElement} iframe
 * @param {string} targetUrl
 * @returns {Promise<MessagePort>}
 */
const initSecureChannel = (iframe, targetUrl) => {
  return new Promise((resolve) => {
    /** @type {MessageChannel} */
    const channel = new MessageChannel();
    apiPort = channel.port1;

    apiPort.onmessage = (event) => {
      /** @type {Object} */
      const data = event.data;

      if (data?.type === 'tiny_pony_api_ready') {
        console.log('[TEST APP] Secure channel ready!');
        resolve(apiPort);
      } else if (data?.type === 'tiny_pony_api_response') {
        console.log('[TEST APP] API Response', data);
        showResponseModal(data);
      }
    };

    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'init_tiny_pony_api' }, targetUrl, [channel.port2]);
    }
  });
};

/**
 * Core function to ensure the API iframe is ready before sending a payload.
 * @returns {Promise<void>}
 */
const ensureIframeReady = async () => {
  /** @type {string} */
  const targetUrl = targetUrlInput.value.replace(/\/$/, '');

  if (targetUrl !== lastTargetUrl || !currentIframe || !apiPort) {
    console.log(`[TEST APP] Loading secure API from ${targetUrl}...`);

    if (apiPort) {
      apiPort.close();
      apiPort = null;
    }

    currentIframe = await loadApiIframe(targetUrl);
    await initSecureChannel(currentIframe, targetUrl);
    lastTargetUrl = targetUrl;
  }
};

/**
 * @param {Object} payload
 * @returns {void}
 */
const sendPayload = (payload) => {
  console.log('[TEST APP] Sending secure message:', payload);
  if (apiPort) {
    apiPort.postMessage(payload);
  } else {
    console.error('[TEST APP] Secure port not initialized!');
  }
};

// --- BUTTON LISTENERS ---

btnSendIp.addEventListener('click', async () => {
  await ensureIframeReady();
  sendPayload({
    action: 'connect_ip',
    requestId: String(Math.random()),
    host: hostIpInput.value,
    pass: hostPassInput.value,
  });
});

btnGenerateOffer.addEventListener('click', async () => {
  await ensureIframeReady();
  sendPayload({
    action: 'generate_offer',
    requestId: String(Math.random()),
  });
});

btnConnectSdp.addEventListener('click', async () => {
  await ensureIframeReady();
  sendPayload({
    action: 'connect_sdp',
    requestId: String(Math.random()),
    answer: sdpAnswerInput.value,
  });
});

btnCheckStatus.addEventListener('click', async () => {
  await ensureIframeReady();
  sendPayload({
    action: 'check_session_status',
    requestId: String(Math.random()),
  });
});

btnPingClient.addEventListener('click', async () => {
  await ensureIframeReady();
  sendPayload({
    action: 'ping',
    requestId: String(Math.random()),
  });
});
