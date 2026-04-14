import {
  btnOpenSettings,
  settingsModal,
  btnCloseSettings,
  latencySlider,
  latencyNumberDisplay,
  latencyStatusText,
} from './html.js';
import { openModal, closeModal } from './Modal.js';

/**
 * The default latency in milliseconds if none is saved.
 * @type {number}
 */
const DEFAULT_LATENCY = 100;

/**
 * The currently active WebRTC Peer Connection.
 * @type {RTCPeerConnection | null}
 */
let activeConnection = null;

/**
 * Updates the visual UI of the latency controller based on the selected value,
 * applying color codes to guide lay users regarding connection stability.
 *
 * @param {number} ms - The latency in milliseconds.
 * @returns {void}
 */
const updateLatencyUI = (ms) => {
  latencyNumberDisplay.textContent = `${ms} ms`;
  latencySlider.value = ms.toString();

  if (ms < 50) {
    latencyStatusText.textContent = 'Too low. High risk of audio/video stuttering.';
    latencyStatusText.style.color = 'var(--accent-red)';
    latencyNumberDisplay.style.color = 'var(--accent-red)';
  } else if (ms <= 150) {
    latencyStatusText.textContent = 'Optimal latency for fast-paced real-time gameplay.';
    latencyStatusText.style.color = 'var(--accent-green)';
    latencyNumberDisplay.style.color = 'var(--accent-green)';
  } else if (ms <= 500) {
    latencyStatusText.textContent = 'Acceptable. You will notice input delay in fast games.';
    latencyStatusText.style.color = 'var(--accent-peach)';
    latencyNumberDisplay.style.color = 'var(--accent-peach)';
  } else {
    latencyStatusText.textContent = 'Very high delay. Not recommended for gaming.';
    latencyStatusText.style.color = 'var(--accent-red)';
    latencyNumberDisplay.style.color = 'var(--accent-red)';
  }
};

/**
 * Injects the chosen latency directly into the active WebRTC receivers.
 *
 * @param {number} ms - The latency in milliseconds.
 * @returns {void}
 */
const applyLatencyToStream = (ms) => {
  if (!activeConnection) return;

  /** @type {number} */
  const delayInSeconds = ms / 1000;

  activeConnection.getReceivers().forEach((receiver) => {
    // Check if the browser supports the API before applying
    if ('playoutDelayHint' in receiver) {
      receiver.playoutDelayHint = delayInSeconds;
    }
  });
};

/**
 * Event handler triggered when the user moves the latency slider.
 *
 * @param {Event} e - The HTML input event.
 * @returns {void}
 */
const handleSliderChange = (e) => {
  /** @type {number} */
  const ms = parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0;

  updateLatencyUI(ms);
  applyLatencyToStream(ms);
  localStorage.setItem('pony_stream_latency', ms.toString());
};

/**
 * Exposes the currently active PeerConnection to the controller so changes apply immediately.
 * * @param {RTCPeerConnection} pc - The active WebRTC connection.
 * @returns {void}
 */
export const setLatencyConnection = (pc) => {
  activeConnection = pc;
  /** @type {number} */
  const currentMs = parseInt(latencySlider.value, 10) || DEFAULT_LATENCY;
  applyLatencyToStream(currentMs);
};

/**
 * Initializes the Latency Controller system, applying saved cache and binding UI events.
 *
 * @returns {void}
 */
export const initLatencyController = () => {
  /** @type {string | null} */
  const cachedData = localStorage.getItem('pony_stream_latency');
  /** @type {number} */
  const initialLatency = cachedData ? parseInt(cachedData, 10) : DEFAULT_LATENCY;

  updateLatencyUI(initialLatency);

  latencySlider.addEventListener('input', handleSliderChange);

  btnOpenSettings.addEventListener('click', () => openModal(settingsModal));
  btnCloseSettings.addEventListener('click', () => closeModal(settingsModal));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.classList.contains('modal-enter')) {
      closeModal(settingsModal);
    }
  });
};
