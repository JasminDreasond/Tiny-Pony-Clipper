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
 * References for the manual Web Audio API fallback delay.
 * @type {AudioContext | null}
 */
let fallbackAudioContext = null;

/**
 * @type {DelayNode | null}
 */
let fallbackDelayNode = null;

/**
 * @type {boolean}
 */
let usesNativeDelay = true;

/**
 * Ensures the value is within the 0-2000ms safe operating range.
 * @param {number} val
 * @returns {number}
 */
const clampLatency = (val) => Math.max(0, Math.min(2000, val));

/**
 * Updates the visual UI of the latency controller based on the selected value,
 * applying color codes to guide lay users regarding connection stability.
 *
 * @param {number} ms - The latency in milliseconds.
 * @returns {void}
 */
const updateLatencyUI = (ms) => {
  // Sync both inputs
  /** @type {HTMLInputElement} */ (latencyNumberDisplay).value = ms.toString();
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
 * Falls back to a custom Web Audio API delayer if native support is missing.
 *
 * @param {number} ms - The latency in milliseconds.
 * @returns {void}
 */
const applyLatencyToStream = (ms) => {
  if (!activeConnection) return;

  /** @type {number} */
  const delayInSeconds = ms / 1000;

  /** @type {boolean} */
  let nativeSupportFound = false;

  activeConnection.getReceivers().forEach((receiver) => {
    // 1. Try the modern W3C standard (jitterBufferTarget uses milliseconds)
    if ('jitterBufferTarget' in receiver) {
      receiver.jitterBufferTarget = ms;
      nativeSupportFound = true;
    }
    // 2. Try the older Chromium standard (playoutDelayHint uses seconds)
    else if ('playoutDelayHint' in receiver) {
      receiver.playoutDelayHint = delayInSeconds;
      nativeSupportFound = true;
    }
  });

  // 3. The "Caseira" (Homemade) Alternative for unsupported browsers
  if (!nativeSupportFound) {
    usesNativeDelay = false;
    if (fallbackDelayNode) {
      // Smoothly ramps up/down the delay to prevent audio cracking noises
      fallbackDelayNode.delayTime.linearRampToValueAtTime(
        delayInSeconds,
        fallbackAudioContext.currentTime + 0.2,
      );
    }
  } else {
    usesNativeDelay = true;
  }
};

/**
 * Master controller that receives input from either the slider, text box, or scroll wheel,
 * clamps it safely, updates the UI, applies it to the stream, and saves it.
 * @param {number} rawMs
 * @returns {void}
 */
const processNewLatency = (rawMs) => {
  const safeMs = clampLatency(rawMs);
  updateLatencyUI(safeMs);
  applyLatencyToStream(safeMs);
  localStorage.setItem('pony_stream_latency', safeMs.toString());
};

/**
 * Applies a manual delay to the audio track using the Web Audio API.
 * This is only engaged if the browser doesn't support WebRTC jitter buffers.
 *
 * @param {MediaStream} stream - The incoming remote stream.
 * @returns {MediaStream} A new stream with the delayed audio track.
 */
const setupManualAudioDelay = (stream) => {
  if (!stream.getAudioTracks().length) return stream;

  try {
    /** @type {typeof window.AudioContext} */
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    fallbackAudioContext = new AudioCtx();

    /** @type {MediaStreamAudioSourceNode} */
    const source = fallbackAudioContext.createMediaStreamSource(stream);

    // Create a delay node with a maximum buffer of 2 seconds (2000ms)
    fallbackDelayNode = fallbackAudioContext.createDelay(2.0);

    /** @type {number} */
    const currentMs = parseInt(latencySlider.value, 10) || DEFAULT_LATENCY;
    fallbackDelayNode.delayTime.value = currentMs / 1000;

    /** @type {MediaStreamAudioDestinationNode} */
    const destination = fallbackAudioContext.createMediaStreamDestination();

    source.connect(fallbackDelayNode);
    fallbackDelayNode.connect(destination);

    // Create a fresh stream combining the original video and the new delayed audio
    /** @type {MediaStream} */
    const delayedStream = new MediaStream();

    stream.getVideoTracks().forEach((track) => delayedStream.addTrack(track));
    destination.stream.getAudioTracks().forEach((track) => delayedStream.addTrack(track));

    console.log('[LATENCY] Native buffer not supported. Applying manual Audio Delay fallback.');
    return delayedStream;
  } catch (err) {
    console.error('[LATENCY] Failed to setup manual audio delay:', err);
    return stream;
  }
};

/**
 * Exposes the currently active PeerConnection to the controller.
 * Also intercepts the media stream to setup fallbacks if necessary.
 *
 * @param {RTCPeerConnection} pc - The active WebRTC connection.
 * @param {MediaStream} remoteStream - The raw stream received from the host.
 * @returns {MediaStream} The processed stream to be attached to the video element.
 */
export const setLatencyConnection = (pc, remoteStream) => {
  activeConnection = pc;

  /** @type {number} */
  const currentMs = parseInt(latencySlider.value, 10) || DEFAULT_LATENCY;

  // Try applying natively first to check support
  applyLatencyToStream(currentMs);

  // If native failed, we wrap the stream in our manual audio delayer
  if (!usesNativeDelay && remoteStream) {
    return setupManualAudioDelay(remoteStream);
  }

  return remoteStream;
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

  // 1. Listen for Slider dragging
  latencySlider.addEventListener('input', (e) => {
    processNewLatency(parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0);
  });

  // 2. Listen for Manual Text Input typing
  latencyNumberDisplay.addEventListener('input', (e) => {
    processNewLatency(parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10) || 0);
  });

  // 3. Listen for Mouse Scroll Wheel over the slider
  latencySlider.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault(); // Prevents the whole page/modal from scrolling

      /** @type {number} */
      const currentMs = parseInt(latencySlider.value, 10) || 0;

      // e.deltaY is positive when scrolling down (towards user), negative when scrolling up
      // We want scroll UP = increase latency, scroll DOWN = decrease latency
      /** @type {number} */
      const step = e.deltaY < 0 ? 10 : -10;

      processNewLatency(currentMs + step);
    },
    { passive: false },
  ); // Requires passive:false to allow e.preventDefault()

  btnOpenSettings.addEventListener('click', () => openModal(settingsModal));
  btnCloseSettings.addEventListener('click', () => closeModal(settingsModal));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal.classList.contains('modal-enter')) {
      closeModal(settingsModal);
    }
  });
};
