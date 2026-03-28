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
import { openModal, closeModal } from './Modal.js';

// --- API BRIDGE & SERVICE WORKER LOGIC ---

/** @type {Record<string, string>} */
let apiOrigins = JSON.parse(localStorage.getItem('pony_api_origins') || '{}');

/**
 * @type {{ origin: string, payload: Object, timer: number } | null}
 */
let pendingApiRequest = null;

/**
 * @type {{ reqId: string, origin: string } | null}
 */
export let activeApiConnection = null;

/** @type {boolean} */
export let isAuthenticating = false;

/** @type {number} */
let lastApiRequestTime = 0;
/** @type {number} */
const RATE_LIMIT_MS = 1500;

/**
 * @param {boolean} state
 * @returns {void}
 */
export const setAuthenticating = (state) => {
  isAuthenticating = state;
};

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

    /** @type {HTMLButtonElement|null} */
    const btn = row.querySelector('button');
    if (btn) btn.onclick = () => removeApiOrigin(origin);

    apiOriginList.appendChild(row);
  });
};

/**
 * @param {string} requestId
 * @param {string} origin
 * @param {'success' | 'error'} status
 * @param {string} code
 * @param {string} message
 * @returns {void}
 */
const sendApiResponse = (requestId, origin, status, code, message) => {
  if (navigator.serviceWorker.controller && requestId) {
    navigator.serviceWorker.controller.postMessage({
      type: 'api_response',
      requestId,
      origin,
      status,
      code,
      message,
    });
  }
};

/**
 * @param {boolean} success
 * @param {string} [errorMsg]
 * @returns {void}
 */
export const resolveApiConnection = (success, errorMsg = '') => {
  if (!activeApiConnection) return;

  /** @type {string} */
  const reqId = activeApiConnection.reqId;
  /** @type {string} */
  const origin = activeApiConnection.origin;

  if (success) {
    sendApiResponse(
      reqId,
      origin,
      'success',
      'SUCCESS_CONNECTED',
      'Login successful and connected',
    );
  } else {
    sendApiResponse(
      reqId,
      origin,
      'error',
      'ERR_CONNECTION_FAILED',
      errorMsg || 'Connection failed',
    );
  }

  activeApiConnection = null;
};

/**
 * @param {any} host
 * @returns {boolean}
 */
const isValidHost = (host) => {
  if (typeof host !== 'string' || host.length > 255 || host.length < 3) return false;
  /** @type {RegExp} */
  const hostRegex = /^(?:wss?:\/\/)?(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?(?:\/.*)?$/;
  return hostRegex.test(host);
};

/**
 * @param {any} b64
 * @returns {boolean}
 */
const isValidBase64 = (b64) => {
  if (typeof b64 !== 'string' || b64.length > 15000 || b64.length < 10) return false;
  /** @type {RegExp} */
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(b64.trim());
};

/**
 * @param {any} pass
 * @returns {string}
 */
const sanitizePassword = (pass) => {
  if (typeof pass !== 'string') return '';
  return pass.substring(0, 100).trim();
};

/**
 * @param {Object} payload
 * @param {string} [payload.action]
 * @param {string} [payload.host]
 * @param {string} [payload.pass]
 * @param {string} [payload.answer]
 * @param {string} [payload.requestId]
 * @returns {{ valid: boolean, error?: string }}
 */
const executeApiPayload = (payload) => {
  console.log('[API PAYLOAD RECEIVED]', payload);

  if (payload.action === 'connect_ip') {
    if (!isValidHost(payload.host)) return { valid: false, error: 'Invalid host format' };

    serverInput.value = payload.host.trim();
    passInput.value = sanitizePassword(payload.pass);
    connMethodSelect.value = 'ip';
    connMethodSelect.dispatchEvent(new Event('change'));
    btnConnect.click();
    return { valid: true };
  } else if (payload.action === 'connect_sdp') {
    if (!isValidBase64(payload.answer)) return { valid: false, error: 'Invalid SDP Base64 format' };

    serverAnswerInput.value = payload.answer.trim();
    connMethodSelect.value = 'sdp';
    connMethodSelect.dispatchEvent(new Event('change'));
    connectManualBtn.click();
    return { valid: true };
  }

  return { valid: false, error: 'Unknown action' };
};

/**
 * @returns {void}
 */
const clearPendingRequest = () => {
  if (pendingApiRequest && pendingApiRequest.timer) {
    clearTimeout(pendingApiRequest.timer);
  }
  pendingApiRequest = null;
  closeModal(apiAuthModal);
};

btnApiAllow.addEventListener('click', () => {
  if (pendingApiRequest) {
    saveApiOrigin(pendingApiRequest.origin, 'allowed');

    /** @type {{ valid: boolean, error?: string }} */
    const result = executeApiPayload(pendingApiRequest.payload);
    /** @type {string|undefined} */
    const reqId = pendingApiRequest.payload.requestId;

    if (reqId) {
      if (result.valid) {
        activeApiConnection = { reqId, origin: pendingApiRequest.origin };
      } else {
        sendApiResponse(
          reqId,
          pendingApiRequest.origin,
          'error',
          'ERR_INVALID_PAYLOAD',
          result.error || 'Invalid payload',
        );
      }
    }
    clearPendingRequest();
  }
});

btnApiDeny.addEventListener('click', () => {
  if (pendingApiRequest) {
    saveApiOrigin(pendingApiRequest.origin, 'blocked');

    /** @type {string|undefined} */
    const reqId = pendingApiRequest.payload.requestId;
    if (reqId)
      sendApiResponse(
        reqId,
        pendingApiRequest.origin,
        'error',
        'ERR_DENIED',
        'Request denied by user',
      );

    clearPendingRequest();
  }
});

btnManageApiOrigins.addEventListener('click', () => {
  renderApiOrigins();
  openModal(apiManagerModal);
});

btnCloseApiManager.addEventListener('click', () => {
  closeModal(apiManagerModal);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && apiManagerModal.classList.contains('modal-enter')) {
    closeModal(apiManagerModal);
  }
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
      /** @type {string|undefined} */
      const reqId = data.payload.requestId;
      /** @type {number} */
      const now = Date.now();

      if (now - lastApiRequestTime < RATE_LIMIT_MS) {
        console.warn(`[API] Rate limit hit from: ${data.origin}`);
        if (reqId)
          sendApiResponse(
            reqId,
            data.origin,
            'error',
            'ERR_RATE_LIMIT',
            'Too many requests. Please slow down.',
          );
        return;
      }
      lastApiRequestTime = now;

      // BLINK: Intercept and reject if the player is already busy with an active stream!
      if (document.body.classList.contains('is-playing')) {
        console.warn(`[API] Ignoring request of ${data.origin} - The player is in a room.`);
        if (reqId)
          sendApiResponse(
            reqId,
            data.origin,
            'error',
            'ERR_BUSY',
            'The player is currently busy playing a game.',
          );
        return; // For the stream here to not open permission modals
      }

      // Universal blocker of shelled requests
      if (isAuthenticating || activeApiConnection || pendingApiRequest) {
        console.warn(`[API] Ignoring request of ${data.origin} - Busy client.`);
        if (reqId)
          sendApiResponse(
            reqId,
            data.origin,
            'error',
            'ERR_BUSY',
            'The client is currently busy processing another request.',
          );
        return;
      }

      /** @type {string} */
      const originStatus = apiOrigins[data.origin];

      if (originStatus === 'allowed') {
        /** @type {{ valid: boolean, error?: string }} */
        const result = executeApiPayload(data.payload);

        if (reqId) {
          if (result.valid) activeApiConnection = { reqId, origin: data.origin };
          else
            sendApiResponse(
              reqId,
              data.origin,
              'error',
              'ERR_INVALID_PAYLOAD',
              result.error || 'Invalid payload format',
            );
        }
      } else if (originStatus === 'blocked') {
        console.warn(`[API] Blocked request from: ${data.origin}`);
        if (reqId)
          sendApiResponse(
            reqId,
            data.origin,
            'error',
            'ERR_BLOCKED',
            'Origin is permanently blocked',
          );
      } else {
        apiAuthOriginText.textContent = data.origin;
        openModal(apiAuthModal);

        pendingApiRequest = {
          origin: data.origin,
          payload: data.payload,
          timer: setTimeout(() => {
            if (pendingApiRequest && pendingApiRequest.payload.requestId === reqId) {
              sendApiResponse(
                reqId,
                data.origin,
                'error',
                'ERR_TIMEOUT',
                'User did not respond in time',
              );
              clearPendingRequest();
            }
          }, 30000),
        };
      }
    }
  });
}
