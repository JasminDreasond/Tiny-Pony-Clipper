import {
  serverInput,
  passInput,
  connMethodSelect,
  btnManageApiOrigins,
  apiManagerModal,
  apiOriginList,
  btnCloseApiManager,
  apiAuthModal,
  apiAuthOriginText,
  btnApiDeny,
  btnApiAllow,
  btnConnect,
  connectManualBtn,
  serverAnswerInput,
} from './html.js';

// --- API BRIDGE & SERVICE WORKER LOGIC ---

/** @type {Record<string, string>} */
let apiOrigins = JSON.parse(localStorage.getItem('pony_api_origins') || '{}');

/** @type {{ origin: string, payload: Object } | null} */
let pendingApiRequest = null;

/**
 * @param {string} origin
 * @param {'allowed' | 'blocked'} status
 * @returns {void}
 */
const saveApiOrigin = (origin, status) => {
  apiOrigins[origin] = status;
  localStorage.setItem('pony_api_origins', JSON.stringify(apiOrigins));
};

/**
 * @param {string} origin
 * @returns {void}
 */
const removeApiOrigin = (origin) => {
  delete apiOrigins[origin];
  localStorage.setItem('pony_api_origins', JSON.stringify(apiOrigins));
  renderApiOrigins();
};

/**
 * @returns {void}
 */
const renderApiOrigins = () => {
  apiOriginList.innerHTML = '';

  /** @type {string[]} */
  const origins = Object.keys(apiOrigins);

  if (origins.length === 0) {
    apiOriginList.innerHTML = '<p style="text-align:center; color:#a6adc8;">No origins saved.</p>';
    return;
  }

  origins.forEach((origin) => {
    /** @type {string} */
    const status = apiOrigins[origin];

    /** @type {HTMLElement} */
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.background = 'rgba(49, 50, 68, 0.6)';
    row.style.padding = '8px 12px';
    row.style.borderRadius = '6px';

    /** @type {string} */
    const color = status === 'allowed' ? '#a6e3a1' : '#f38ba8';

    row.innerHTML = `
      <span style="font-family: monospace; font-size: 13px; color: ${color};">${origin} (${status})</span>
      <button style="width: auto; padding: 6px 10px; margin: 0; font-size: 12px; background: #45475a; color: #cdd6f4;">Remove</button>
    `;

    const btn = row.querySelector('button');
    btn.onclick = () => removeApiOrigin(origin);

    apiOriginList.appendChild(row);
  });
};

/**
 * @param {string} requestId
 * @param {string} origin
 * @param {'success' | 'error'} status
 * @param {string} message
 * @returns {void}
 */
const sendApiResponse = (requestId, origin, status, message) => {
  if (navigator.serviceWorker.controller && requestId) {
    navigator.serviceWorker.controller.postMessage({
      type: 'api_response',
      requestId,
      origin,
      status,
      message,
    });
  }
};

/**
 * @param {Object} payload
 * @param {string} [payload.action]
 * @param {string} [payload.host]
 * @param {string} [payload.pass]
 * @param {string} [payload.answer]
 * @param {string} [payload.requestId]
 * @returns {Promise<void>}
 */
const executeApiPayload = async (payload) => {
  console.log('[API PAYLOAD RECEIVED]', payload);

  if (payload.action === 'connect_ip') {
    serverInput.value = payload.host || '';
    passInput.value = payload.pass || '';
    connMethodSelect.value = 'ip';
    connMethodSelect.dispatchEvent(new Event('change'));
    btnConnect.click();
  } else if (payload.action === 'connect_sdp') {
    serverAnswerInput.value = payload.answer || '';
    connMethodSelect.value = 'sdp';
    connMethodSelect.dispatchEvent(new Event('change'));
    connectManualBtn.click();
  }
};

btnApiAllow.addEventListener('click', () => {
  if (pendingApiRequest) {
    saveApiOrigin(pendingApiRequest.origin, 'allowed');
    executeApiPayload(pendingApiRequest.payload);

    /** @type {string|undefined} */
    const reqId = pendingApiRequest.payload.requestId;
    if (reqId)
      sendApiResponse(reqId, pendingApiRequest.origin, 'success', 'Request allowed by user');

    pendingApiRequest = null;
  }
  apiAuthModal.style.display = 'none';
});

btnApiDeny.addEventListener('click', () => {
  if (pendingApiRequest) {
    saveApiOrigin(pendingApiRequest.origin, 'blocked');

    /** @type {string|undefined} */
    const reqId = pendingApiRequest.payload.requestId;
    if (reqId) sendApiResponse(reqId, pendingApiRequest.origin, 'error', 'Request denied by user');

    pendingApiRequest = null;
  }
  apiAuthModal.style.display = 'none';
});

btnManageApiOrigins.addEventListener('click', () => {
  renderApiOrigins();
  apiManagerModal.style.display = 'flex';
});

btnCloseApiManager.addEventListener('click', () => {
  apiManagerModal.style.display = 'none';
});

// Service Worker Registration and Message Handling
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    console.log('[SW] Service Worker Registered for Main App');
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    /** @type {Object} */
    const data = event.data;

    if (data && data.type === 'api_request') {
      /** @type {string} */
      const originStatus = apiOrigins[data.origin];
      /** @type {string|undefined} */
      const reqId = data.payload.requestId;

      if (originStatus === 'allowed') {
        executeApiPayload(data.payload);
        if (reqId) sendApiResponse(reqId, data.origin, 'success', 'Origin automatically allowed');
      } else if (originStatus === 'blocked') {
        console.warn(`[API] Blocked request from: ${data.origin}`);
        if (reqId) sendApiResponse(reqId, data.origin, 'error', 'Origin is blocked');
      } else {
        pendingApiRequest = data;
        apiAuthOriginText.textContent = data.origin;
        apiAuthModal.style.display = 'flex';
      }
    }
  });
}
