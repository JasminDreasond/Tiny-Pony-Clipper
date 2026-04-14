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
  wantsVideoInput,
  wantsAudioInput,
  useKbPadInput,
} from './html.js';
import { openModal, closeModal } from './Modal.js';
import { sendBackgroundNotification } from './Notification.js';

// --- API BRIDGE LOGIC ---

/** @type {Record<string, string>} */
let apiOrigins = JSON.parse(localStorage.getItem('pony_api_origins') || '{}');

/** @type {{ origin: string, payload: Object, timer: NodeJS.Timeout } | null} */
let pendingApiRequest = null;

/** @type {{ reqId: string, origin: string } | null} */
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
 * Checks if the application is currently running securely within the Electron wrapper
 * via the custom local protocol.
 * @type {boolean}
 */
const isNativeAppProtocol = window.location.protocol === 'app:';

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
    apiOriginList.innerHTML =
      '<p style="text-align:center; color:var(--text-sub);">No origins saved.</p>';
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
    row.style.background = 'var(--hud-btn-bg)';
    row.style.padding = '8px 12px';
    row.style.borderRadius = '6px';

    /** @type {string} */
    const color = status === 'allowed' ? 'var(--accent-green)' : 'var(--accent-red)';

    row.innerHTML = `
      <span style="font-family: monospace; font-size: 13px; color: ${color};">${origin} (${status})</span>
      <button style="width: auto; padding: 6px 10px; margin: 0; font-size: 12px; background: var(--bg-surface1); color: var(--text-main);">Remove</button>
    `;

    /** @type {HTMLButtonElement|null} */
    const btn = row.querySelector('button');
    if (btn) btn.onclick = () => removeApiOrigin(origin);

    apiOriginList.appendChild(row);
  });
};

/**
 * Sends the response back either to the Service Worker (Web) or directly to the Preload Bridge (App).
 *
 * @param {string} requestId
 * @param {string} origin
 * @param {'success' | 'error'} status
 * @param {string} code
 * @param {string} message
 * @param {any} [data]
 * @returns {void}
 */
const sendApiResponse = (requestId, origin, status, code, message, data = null) => {
  if (!requestId) return;

  /** @type {Object} */
  const payload = { type: 'api_response', requestId, origin, status, code, message, data };

  if (isNativeAppProtocol) {
    // If native, blast it to window for preload-public.js to catch
    window.postMessage(payload, '*');
  } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    // If web, send it to the Service Worker Controller
    navigator.serviceWorker.controller.postMessage(payload);
  }
};

/**
 * @param {boolean} success
 * @param {string} [errorMsg]
 * @returns {void}
 */
export const resolveApiConnection = (success, errorMsg = '') => {
  if (!activeApiConnection) return;

  const { reqId, origin } = activeApiConnection;

  if (success) {
    sendApiResponse(
      reqId,
      origin,
      'success',
      'SUCCESS_CONNECTED',
      'Login successful and connected',
    );
  } else {
    const errMsg = errorMsg || 'Connection failed';
    sendApiResponse(reqId, origin, 'error', 'ERR_CONNECTION_FAILED', errMsg);
    sendBackgroundNotification('Tiny Pony Stream', errMsg);
  }

  activeApiConnection = null;
};

/**
 * @param {any} host
 * @returns {boolean}
 */
const isValidHost = (host) => {
  if (typeof host !== 'string' || host.length > 255 || host.length < 3) return false;
  return /^(?:wss?:\/\/)?(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?(?:\/.*)?$/.test(host);
};

/**
 * @param {any} b64
 * @returns {boolean}
 */
const isValidBase64 = (b64) => {
  if (typeof b64 !== 'string' || b64.length > 15000 || b64.length < 10) return false;
  return /^[A-Za-z0-9+/=]+$/.test(b64.trim());
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
 * @param {boolean|string} [payload.video]
 * @param {boolean|string} [payload.audio]
 * @param {boolean|string} [payload.kbpad]
 * @returns {Promise<{ valid: boolean, error?: string, data?: any }>}
 */
const executeApiPayload = async (payload) => {
  console.log('[API PAYLOAD RECEIVED]', payload);

  /**
   * Applies optional media and input preferences if they were provided in the API payload.
   */
  const applyPreferences = () => {
    if (payload.video !== undefined) {
      wantsVideoInput.checked = String(payload.video) === 'true';
      wantsVideoInput.dispatchEvent(new Event('change'));
    }
    if (payload.audio !== undefined) {
      wantsAudioInput.checked = String(payload.audio) === 'true';
      wantsAudioInput.dispatchEvent(new Event('change'));
    }
    if (payload.kbpad !== undefined) {
      useKbPadInput.checked = String(payload.kbpad) === 'true';
      useKbPadInput.dispatchEvent(new Event('change'));
    }
  };

  if (payload.action === 'connect_ip') {
    if (!isValidHost(payload.host)) return { valid: false, error: 'Invalid host format' };
    applyPreferences();
    serverInput.value = payload.host.trim();
    passInput.value = sanitizePassword(payload.pass);
    connMethodSelect.value = 'ip';
    connMethodSelect.dispatchEvent(new Event('change'));
    btnConnect.click();
    return { valid: true };
  } else if (payload.action === 'connect_sdp') {
    if (!isValidBase64(payload.answer)) return { valid: false, error: 'Invalid SDP Base64 format' };
    applyPreferences();
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

btnCloseApiManager.addEventListener('click', () => closeModal(apiManagerModal));

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && apiManagerModal.classList.contains('modal-enter')) {
    closeModal(apiManagerModal);
  }
});

/**
 * Universal handler for processing both ServiceWorker and Native IPC API Requests.
 *
 * @param {Object} data
 * @returns {Promise<void>}
 */
const handleIncomingApiRequest = async (data) => {
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

    if (
      now - lastApiRequestTime < RATE_LIMIT_MS &&
      data.payload.action !== 'check_session_status'
    ) {
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
      if (!isStatusCheck || originStatus !== 'allowed') {
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
      // Differentiates the Modal Text if it's the internal CLI to make it less scary for local users
      if (data.origin === 'Local System (CLI)') {
        document.querySelector('#apiAuthModal p').textContent =
          'Your local machine (CLI Terminal) is trying to interact with your client.';
      } else {
        document.querySelector('#apiAuthModal p').textContent =
          'An external application is trying to connect to your client.';
      }

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
};

// --- ROUTER: ServiceWorker vs Native Window IPC ---

if (isNativeAppProtocol) {
  console.log('[API ROUTER] App Native Protocol Detected. SW Disabled. Using IPC Bridge.');

  // Listens to direct messages dispatched by preload-public.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    handleIncomingApiRequest(event.data);
  });
} else if ('serviceWorker' in navigator) {
  console.log('[API ROUTER] Web Protocol Detected. Registering Service Worker.');
  navigator.serviceWorker.register('/sw.js').then(() => {
    console.log('[SW] Service Worker Registered for Main App');
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    handleIncomingApiRequest(event.data);
  });
}
