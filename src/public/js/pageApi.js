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
 * @type {{ origin: string, payload: Object, timer: NodeJS.Timeout } | null}
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

/** @type {Set<string>} */
const processedRequests = new Set();

/** @type {(() => Promise<string>) | null} */
export let onGenerateOffer = null;

/**
 * @param {() => Promise<string>} cb
 * @returns {void}
 */
export const setGenerateOfferCallback = (cb) => {
  onGenerateOffer = cb;
};

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
 * @param {any} [data]
 * @returns {void}
 */
const sendApiResponse = (requestId, origin, status, code, message, data = null) => {
  if (navigator.serviceWorker.controller && requestId) {
    navigator.serviceWorker.controller.postMessage({
      type: 'api_response',
      requestId,
      origin,
      status,
      code,
      message,
      data,
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
 * @returns {Promise<{ valid: boolean, error?: string, data?: any }>}
 */
const executeApiPayload = async (payload) => {
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
  } else if (payload.action === 'generate_offer') {
    if (onGenerateOffer) {
      try {
        /** @type {string} */
        const base64Offer = await onGenerateOffer();
        return { valid: true, data: { offer: base64Offer } };
      } catch (err) {
        return { valid: false, error: 'Failed to generate WebRTC offer' };
      }
    }
    return { valid: false, error: 'Offer generator is not initialized' };
  } else if (payload.action === 'check_session_status') {
    /** @type {boolean} */
    const isPlaying = document.body.classList.contains('is-playing');
    return { valid: true, data: { isPlaying } };
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

btnApiAllow.addEventListener('click', async () => {
  if (pendingApiRequest) {
    saveApiOrigin(pendingApiRequest.origin, 'allowed');

    /** @type {Object} */
    const payload = pendingApiRequest.payload;
    /** @type {string} */
    const origin = pendingApiRequest.origin;
    /** @type {string|undefined} */
    const reqId = payload.requestId;

    /** @type {{ valid: boolean, error?: string, data?: any }} */
    const result = await executeApiPayload(payload);

    if (reqId) {
      if (result.valid) {
        if (payload.action === 'generate_offer') {
          sendApiResponse(
            reqId,
            origin,
            'success',
            'SUCCESS_OFFER_GENERATED',
            'Offer generated successfully',
            result.data,
          );
        } else if (payload.action === 'check_session_status') {
          sendApiResponse(
            reqId,
            origin,
            'success',
            'SUCCESS_STATUS_CHECKED',
            'Status retrieved successfully',
            result.data,
          );
        } else {
          activeApiConnection = { reqId, origin };
        }
      } else {
        sendApiResponse(
          reqId,
          origin,
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

  navigator.serviceWorker.addEventListener('message', async (event) => {
    /** @type {Object} */
    const data = event.data;

    if (data && data.type === 'api_request') {
      /** @type {string|undefined} */
      const reqId = data.payload.requestId;

      if (reqId) {
        if (processedRequests.has(reqId)) {
          console.warn(`[API] Duplicate request blocked: ${reqId}`);
          sendApiResponse(
            reqId,
            data.origin,
            'error',
            'ERR_DUPLICATE_REQUEST',
            'This requestId is already in use.',
          );
          return;
        }

        processedRequests.add(reqId);
        setTimeout(() => processedRequests.delete(reqId), 600000);
      }

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

      /** @type {boolean} */
      const isPing = data.payload.action === 'ping';

      // Ping is silent and bypasses permission modals and busy states
      if (isPing) {
        if (reqId)
          sendApiResponse(
            reqId,
            data.origin,
            'success',
            'SUCCESS_CLIENT_ALIVE',
            'The client is open and ready.',
            { alive: true },
          );
        return;
      }

      /** @type {string} */
      const originStatus = apiOrigins[data.origin];
      /** @type {boolean} */
      const isStatusCheck = data.payload.action === 'check_session_status';

      // BLINK: Intercept and reject if the player is already busy with an active stream!
      if (document.body.classList.contains('is-playing')) {
        if (isStatusCheck && originStatus === 'allowed') {
          // Allows you to check invisibly if the site is already reliable
        } else {
          console.warn(`[API] Ignoring request of ${data.origin} - The player is in a room.`);
          if (reqId)
            sendApiResponse(
              reqId,
              data.origin,
              'error',
              'ERR_BUSY',
              'The player is currently busy playing a game.',
            );
          return;
        }
      }

      // Universal blocker of shelled requests
      if (!isStatusCheck && (isAuthenticating || activeApiConnection || pendingApiRequest)) {
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

      if (originStatus === 'allowed') {
        /** @type {{ valid: boolean, error?: string, data?: any }} */
        const result = await executeApiPayload(data.payload);

        if (reqId) {
          if (result.valid) {
            if (data.payload.action === 'generate_offer') {
              sendApiResponse(
                reqId,
                data.origin,
                'success',
                'SUCCESS_OFFER_GENERATED',
                'Offer generated successfully',
                result.data,
              );
            } else if (data.payload.action === 'check_session_status') {
              sendApiResponse(
                reqId,
                data.origin,
                'success',
                'SUCCESS_STATUS_CHECKED',
                'Status retrieved successfully',
                result.data,
              );
            } else {
              activeApiConnection = { reqId, origin: data.origin };
            }
          } else {
            sendApiResponse(
              reqId,
              data.origin,
              'error',
              'ERR_INVALID_PAYLOAD',
              result.error || 'Invalid payload format',
            );
          }
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
