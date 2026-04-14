import { compressToBase64, decompressFromBase64 } from './gzipBase64.js';

import {
  video,
  serverInput,
  passInput,
  btnConnect,
  loginDiv,
  btnToggleDebug,
  debugPanel,
  wantsAudioInput,
  wantsVideoInput,
  stunInput,
  connMethodSelect,
  ipSection,
  sdpSection,
  clientIdHud,
  dbgPing,

  // Keyboard Gamepad UI
  useKbPadInput,
  kbModal,
  btnOpenTx,

  // Debug Elements
  dbgWs,
  dbgRtcConn,
  dbgRtcIce,
  dbgVidTrack,
  dbgVidPlay,
  dbgVidRes,
  dbgDc,
  dbgPad,
  dbgInput,

  // Manual SDP Elements
  generateOfferBtn,
  myOfferOutput,
  connectManualBtn,
  serverAnswerInput,
  btnHudKbConfig,

  // Tab Configuration Elements
  tabKbContent,
  tabProfileContent,
  tabFilterContent,

  // Profile Manager Elements
  rawGamepadDebugger,
} from './html.js';
import { showAlert } from './Modal.js';
import { sendBackgroundNotification } from './Notification.js';
import { resolveApiConnection, setAuthenticating, setGenerateOfferCallback } from './PageApi.js';
import {
  remapGamepad,
  virtualPad,
  visualizerPad,
  isGamepadAllowed,
  updateCanvasColors,
} from './GamepadInput.js';
import { startPlayTimer, stopPlayTimer, bypassWelcome } from './Welcome.js';
import { initLatencyController, setLatencyConnection } from './LatencyController.js';

/** @type {NodeJS.Timeout | null} */
let notificationTimer = null;

setGenerateOfferCallback(async () => {
  bypassWelcome();
  checkMediaPreferences();

  // Shows in the client's visual interface that something external is using SDP
  myOfferOutput.value = 'Gathering ICE candidates (API Request)...';

  /** @type {RTCConfiguration} */
  const rtcConfig = { iceServers: [{ urls: iceServerUrls }] };

  /** @type {string} */
  const offerString = await generateClientOffer(rtcConfig);

  /** @type {string} */
  const b64Offer = await compressToBase64(offerString);

  myOfferOutput.value = b64Offer;
  updateDebug(dbgWs, 'API SDP Ready', 'ok');

  return b64Offer;
});

/**
 * Displays a temporary toast notification on the screen to inform the user of disconnections.
 *
 * @param {string} message - The text to display inside the toast.
 * @returns {void}
 */
const showDisconnectNotification = (message) => {
  /** @type {HTMLElement} */
  const toast = document.getElementById('disconnectToast');
  toast.textContent = message;
  toast.classList.add('show');

  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => toast.classList.remove('show'), 5000);
};

connMethodSelect.addEventListener('change', () => {
  bypassWelcome(); // Auto-skip if API invokes a change here
  if (connMethodSelect.value === 'ip') {
    ipSection.classList.remove('section-hidden');
    sdpSection.classList.add('section-hidden');
  } else {
    ipSection.classList.add('section-hidden');
    sdpSection.classList.remove('section-hidden');
  }
});

/**
 * Waits for the WebRTC ICE candidate gathering process to complete.
 *
 * @param {RTCPeerConnection} peerConnection - The connection gathering the candidates.
 * @returns {Promise<void>} Resolves when the ICE gathering state is 'complete'.
 */
const waitForIceGathering = (peerConnection) => {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      peerConnection.addEventListener('icegatheringstatechange', checkState);
    }
  });
};

/** @type {RTCPeerConnection | null} */
let pc = null;
/** @type {RTCDataChannel | null} */
let dataChannel = null;
/** @type {boolean} */
let audioRequested = true;
/** @type {boolean} */
let videoRequested = true;
/** @type {WebSocket | null} */
let ws = null;
/** @type {string[]} */
let iceServerUrls = [];

// The Gamepad Cache Map
/** @type {Map<number, boolean>} */
const activeGamepadsCache = new Map();

/**
 * Parses a comma-separated string of STUN/TURN server URLs into an array.
 *
 * @param {string} customStun - The raw string input containing the server URLs.
 * @returns {string[]} An array of cleaned up server URLs.
 */
const parseStunUrls = (customStun) =>
  customStun
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s);

/**
 * Reads the DOM input fields to update the user's media preferences (audio/video).
 * Toggles the UI into a 'gamepad-only' mode if video is disabled.
 *
 * @returns {void}
 */
const checkMediaPreferences = () => {
  audioRequested = wantsAudioInput.checked;
  videoRequested = wantsVideoInput.checked;
  iceServerUrls = parseStunUrls(stunInput.value);

  if (!videoRequested) {
    document.body.classList.add('gamepad-only-mode');
    updateDebug(dbgVidTrack, 'Disabled', 'warn');
    updateDebug(dbgVidPlay, 'Disabled', 'warn');
  } else {
    document.body.classList.remove('gamepad-only-mode');
  }
};

/**
 * Initializes a new WebRTC PeerConnection, generates an offer based on media preferences,
 * and waits for all ICE candidates to be gathered for manual signaling.
 *
 * @param {RTCConfiguration} config - The WebRTC configuration object (e.g., ICE servers).
 * @returns {Promise<string>} The stringified local session description (SDP).
 */
export const generateClientOffer = async (config) => {
  bypassWelcome();
  pc = new RTCPeerConnection(config);
  setupWebRTCEvents();

  const offer = await pc.createOffer({
    offerToReceiveVideo: videoRequested,
    offerToReceiveAudio: audioRequested,
  });

  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  return JSON.stringify(pc.localDescription);
};

/**
 * Applies the server's base64-decoded answer to the local PeerConnection to finalize the WebRTC handshake.
 *
 * @param {string} answerString - The JSON stringified remote session description.
 * @returns {Promise<void>} Resolves when the remote description is successfully set.
 */
export const applyServerAnswer = async (answerString) => {
  if (!pc) return;
  /** @type {RTCSessionDescriptionInit} */
  const remoteAnswer = JSON.parse(answerString);
  await pc.setRemoteDescription(remoteAnswer);
};

/**
 * @returns {void}
 */
const updateHudButtons = () => {
  /** @type {boolean} */
  const isPlaying = document.body.classList.contains('is-playing');

  btnHudKbConfig.style.display = isPlaying ? 'inline-block' : 'none';
  btnOpenTx.style.display = isPlaying ? 'inline-block' : 'none';
};

useKbPadInput.addEventListener('change', (e) => {
  virtualPad.connected = e.target.checked;
  localStorage.setItem('pony_use_kb', e.target.checked.toString());
  updateHudButtons();
});

wantsVideoInput.addEventListener('change', (e) => {
  localStorage.setItem('pony_wants_video', e.target.checked.toString());
});

wantsAudioInput.addEventListener('change', (e) => {
  localStorage.setItem('pony_wants_audio', e.target.checked.toString());
});

// --- MAIN APPLICATION RESTORE ---

// --- DOM Event Listeners for Manual SDP ---
generateOfferBtn.addEventListener('click', async () => {
  bypassWelcome(); // Auto-skip just in case
  checkMediaPreferences();
  myOfferOutput.value = 'Gathering ICE candidates...';

  /** @type {RTCConfiguration} */
  const rtcConfig = { iceServers: [{ urls: iceServerUrls }] };

  /** @type {string} */
  const offerString = await generateClientOffer(rtcConfig);

  // Encodes the offer to Base64 before displaying it on screen
  myOfferOutput.value = await compressToBase64(offerString);
  updateDebug(dbgWs, 'Manual SDP Ready', 'ok');
});

connectManualBtn.addEventListener('click', async () => {
  bypassWelcome(); // Auto-skip when triggered by API or user
  setAuthenticating(true); // Locking connections coming from the API

  /** @type {string} */
  const b64Answer = serverAnswerInput.value.trim();

  if (b64Answer) {
    /** @type {string} */
    let answerStr = '';

    try {
      answerStr = await decompressFromBase64(b64Answer);
      // Checks if it decoded into a valid JSON
      JSON.parse(answerStr);
    } catch (e) {
      setAuthenticating(false);
      resolveApiConnection(false, 'Invalid Base64 format');
      showAlert(
        'Invalid Base64 format! Please ensure you copied the exact code the server gave you.',
      );
      return;
    }

    try {
      await applyServerAnswer(answerStr);
      console.log('[CLIENT] Connected via manual signaling!');
      loginDiv.style.display = 'none';
      document.body.classList.add('is-playing');
      startPlayTimer();
      updateHudButtons();
      if (videoRequested) video.style.display = 'block';

      setAuthenticating(false);
      resolveApiConnection(true);
      sendBackgroundNotification('Tiny Pony Stream', 'Connected via manual signaling!');
    } catch (error) {
      setAuthenticating(false);
      resolveApiConnection(false, 'Failed to apply SDP answer');
    }
  } else {
    setAuthenticating(false);
    resolveApiConnection(false, 'Empty SDP answer');
  }
});

// Recover password and settings from cache
window.onload = () => {
  /** @type {string | null} */
  const cachedHost = localStorage.getItem('pony_stream_host');
  /** @type {string | null} */
  const cachedPass = localStorage.getItem('pony_stream_pass');
  /** @type {string | null} */
  const cachedStun = localStorage.getItem('pony_stream_stun');

  /** @type {string | null} */
  const cachedVideo = localStorage.getItem('pony_wants_video');
  /** @type {string | null} */
  const cachedAudio = localStorage.getItem('pony_wants_audio');
  /** @type {string | null} */
  const cachedUseKb = localStorage.getItem('pony_use_kb');

  if (cachedHost) serverInput.value = cachedHost;
  if (cachedPass) passInput.value = cachedPass;
  if (cachedStun) stunInput.value = cachedStun;

  if (cachedVideo !== null) wantsVideoInput.checked = cachedVideo === 'true';
  if (cachedAudio !== null) wantsAudioInput.checked = cachedAudio === 'true';
  if (cachedUseKb !== null) {
    useKbPadInput.checked = cachedUseKb === 'true';
    virtualPad.connected = useKbPadInput.checked;
  }
};

// Pressing Enter in the password field submits the form
passInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') initConnection();
});

/**
 * Updates a specific element in the debug panel with text and a color-coded state.
 *
 * @param {HTMLElement} el - The DOM element to update.
 * @param {string} text - The new text content for the element.
 * @param {'error' | 'warn' | 'ok'} [state] - The visual state to apply (changes the text color).
 * @returns {void}
 */
const updateDebug = (el, text, state) => {
  el.textContent = text;
  el.classList.remove('debug-err', 'debug-warn');
  if (state === 'error') el.classList.add('debug-err');
  else if (state === 'warn') el.classList.add('debug-warn');
};

/**
 * Toggles the visibility of the on-screen debug panel and the client ID HUD.
 *
 * @returns {void}
 */
const toggleDebug = () => {
  /** @type {boolean} */
  const isHidden = debugPanel.classList.toggle('hidden');
  btnToggleDebug.textContent = isHidden ? 'Show Debug (F2)' : 'Hide Debug (F2)';
  if (isHidden) clientIdHud.classList.add('hidden');
  else clientIdHud.classList.remove('hidden');
  btnToggleDebug.blur(); // Removes focus from the button
};

btnToggleDebug.addEventListener('click', toggleDebug);

// F2 keyboard shortcut to toggle
window.addEventListener('keydown', (e) => {
  if (e.key === 'F2' && !kbModal.classList.contains('modal-enter')) {
    e.preventDefault();
    toggleDebug();
  }
});

// --- GAMEPAD DETECTION (CACHE SYSTEM) ---

window.addEventListener('gamepadconnected', (event) => {
  activeGamepadsCache.set(event.gamepad.index, true);
  console.log('[INPUT] Gamepad connected:', event.gamepad.id);
});

window.addEventListener('gamepaddisconnected', (event) => {
  activeGamepadsCache.delete(event.gamepad.index);
  console.log('[INPUT] Gamepad disconnected:', event.gamepad.index);
});

// --- NETWORKING ---

/**
 * Initializes the WebSocket connection to the server for automatic IP-based signaling and authentication.
 *
 * @returns {void}
 */
const initConnection = () => {
  bypassWelcome(); // Auto-skip if API fired the button directly
  // Uses the current browser port for the WebSocket
  setAuthenticating(true); // Locking API

  /** @type {boolean} */
  let isConnecting = true;

  checkMediaPreferences();
  localStorage.setItem('pony_stream_stun', stunInput.value.trim());

  /** @type {string} */
  let host = !serverInput.disabled ? serverInput.value.trim() : `ws://${window.location.host}`;

  if (!host) {
    setAuthenticating(false);
    resolveApiConnection(false, 'Missing server IP');
    showAlert('Please provide a server IP or address.');
    return;
  }
  if (!host.startsWith('ws://') && !host.startsWith('wss://')) host = `ws://${host}`;

  updateDebug(dbgWs, 'Connecting...', 'warn');
  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';

  try {
    ws = new WebSocket(host);
  } catch (err) {
    setAuthenticating(false);
    updateDebug(dbgWs, 'Invalid URL', 'error');
    resolveApiConnection(false, 'Invalid server address format');
    showAlert('Invalid server address format.');
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect & Play';
    return;
  }

  ws.onopen = () => {
    updateDebug(dbgWs, 'Auth...', 'warn');
    localStorage.setItem('pony_stream_host', serverInput.value.trim());
    ws.send(JSON.stringify({ type: 'auth', password: passInput.value }));
  };

  ws.onclose = () => {
    updateDebug(dbgWs, 'Disconnected', 'error');
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect & Play';
    stopPlayTimer();

    if (isConnecting) {
      setAuthenticating(false);
      resolveApiConnection(false, 'Server disconnected before authentication');
      isConnecting = false;
    }
  };

  ws.onerror = () => {
    updateDebug(dbgWs, 'Error', 'error');
    stopPlayTimer();
    if (isConnecting) {
      setAuthenticating(false);
      resolveApiConnection(false, 'WebSocket connection error');
      isConnecting = false;
    }
  };

  ws.onmessage = async (event) => {
    /** @type {Object} */
    const data = JSON.parse(event.data);

    if (data.type === 'auth_success') {
      isConnecting = false;

      if (data.clientId) {
        clientIdHud.style.display = 'block';
        document.getElementById('myClientId').textContent = data.clientId;
      }

      // Saves to cache
      localStorage.setItem('pony_stream_pass', passInput.value);

      updateDebug(dbgWs, 'Connected', 'ok');
      loginDiv.style.display = 'none';
      document.body.classList.add('is-playing');
      startPlayTimer();
      updateHudButtons();
      btnOpenTx.style.display = 'block'; // Show Transmitter button on auth

      // Makes the STUN server flexible by reading from config
      iceServerUrls = [];
      if (data.iceServers) {
        /** @type {string[]} */
        const serverUrls = parseStunUrls(data.iceServers);
        if (serverUrls.length > 0) iceServerUrls = serverUrls;
        console.log(`[HOST ICE SERVERS]`, serverUrls);
      }

      if (videoRequested) video.style.display = 'block';

      setupIPWebRTC();

      setAuthenticating(false);
      resolveApiConnection(true);
      sendBackgroundNotification('Tiny Pony Stream', 'Connected to the server successfully!');
    } else if (data.type === 'auth_error') {
      isConnecting = false;
      setAuthenticating(false);
      updateDebug(dbgWs, 'Auth Failed', 'error');

      resolveApiConnection(false, 'Wrong password');
      showAlert('Wrong password!');

      btnConnect.disabled = false;
      btnConnect.textContent = 'Connect & Play';
      ws.close();
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'ice_candidate') {
      if (data.candidate && data.candidate.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } else if (data.type === 'server_warning') {
      updateDebug(dbgPad, 'Limit Reached / Kicked!', 'error');
      dbgInput.innerHTML += `<br><span style="color:var(--accent-red); font-weight:bold;">${data.message}</span>`;
      const msgErr = `Host Message: ${data.message}`;
      showDisconnectNotification(msgErr);
      sendBackgroundNotification('Tiny Pony Stream', msgErr);
      console.warn('[SERVER WARNING]', data.message);
    }
  };
};

/**
 * Configures all necessary event listeners for the WebRTC PeerConnection.
 * Handles data channels (ping/pong, gamepad inputs), connection states, and incoming video tracks.
 *
 * @returns {void}
 */
const setupWebRTCEvents = () => {
  updateDebug(dbgRtcConn, 'Initializing...', 'warn');

  // DataChannel configuration for Inputs (Unreliable/Unordered for minimum latency)
  dataChannel = pc.createDataChannel('gamepad', { ordered: false, maxRetransmits: 0 });

  /** @type {number} */
  let pingInterval;

  dataChannel.onopen = () => {
    updateDebug(dbgDc, 'Open', 'ok');

    // Starts sending Ping every 2 seconds
    pingInterval = setInterval(() => {
      if (dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'ping', time: Date.now() }));
      }
    }, 2000);
  };

  dataChannel.onclose = () => {
    updateDebug(dbgDc, 'Closed', 'error');
    if (pingInterval) clearInterval(pingInterval);
  };

  dataChannel.onmessage = (event) => {
    /** @type {Object} */
    const msg = JSON.parse(event.data);

    if (msg.type === 'server_hello') {
      clientIdHud.style.display = 'block';
      document.getElementById('myClientId').textContent = msg.clientId;
    } else if (msg.type === 'vibration') {
      /** @type {Gamepad[]} */
      const gamepads = navigator.getGamepads();
      /** @type {Gamepad | null} */
      const gp = gamepads[msg.index];

      if (gp && gp.vibrationActuator) {
        gp.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: msg.duration || 200,
          weakMagnitude: msg.weak || 0.5,
          strongMagnitude: msg.strong || 0.5,
        });
      }
    } else if (msg.type === 'pong') {
      // Calculates round-trip time (latency)
      /** @type {number} */
      const currentLatency = Date.now() - msg.time;

      // Updates the client debug screen
      updateDebug(
        dbgPing,
        `${currentLatency} ms`,
        currentLatency < 80 ? 'ok' : currentLatency < 150 ? 'warn' : 'error',
      );

      // Sends the result to the Host to log on their panel
      dataChannel.send(JSON.stringify({ type: 'client_latency', latency: currentLatency }));
    } else if (msg.type === 'server_warning') {
      // ---> THIS ALLOWS THE P2P CLIENT TO READ SERVER WARNINGS <---
      updateDebug(dbgPad, 'Limit Reached / Kicked!', 'error');
      dbgInput.innerHTML += `<br><span style="color:#f38ba8; font-weight:bold;">${msg.message}</span>`;
      const msgErr = `Host Message: ${msg.message}`;
      showDisconnectNotification(msgErr);
      sendBackgroundNotification('Tiny Pony Stream', msgErr);
      console.warn('[SERVER WARNING]', msg.message);
    }
  };

  // Connection State Monitoring
  pc.onconnectionstatechange = () => {
    /** @type {string} */
    const s = pc.connectionState;
    updateDebug(
      dbgRtcConn,
      s,
      s === 'disconnected' || s === 'failed' ? 'error' : s === 'connected' ? 'ok' : 'warn',
    );

    if (s === 'disconnected' || s === 'failed') {
      const msgErr = 'Lost connection to host.';
      showDisconnectNotification(msgErr);
      sendBackgroundNotification('Tiny Pony Stream', msgErr);
      stopPlayTimer();
    }
  };

  pc.oniceconnectionstatechange = () => {
    /** @type {string} */
    const s = pc.iceConnectionState;
    updateDebug(
      dbgRtcIce,
      s,
      s === 'disconnected' || s === 'failed' ? 'error' : s === 'connected' ? 'ok' : 'warn',
    );
  };

  // --- VIDEO DEBUGGING LOGIC ---

  if (videoRequested) {
    pc.ontrack = (event) => {
      console.log('[WEBRTC] Video track received:', event.track);
      updateDebug(dbgVidTrack, `Recv (${event.track.kind})`, 'ok');
      const processedStream = setLatencyConnection(pc, event.streams[0]);

      if (video.srcObject !== processedStream) {
        video.srcObject = processedStream;

        // Tries to force playback. Browsers require 'muted' for autoplay without user interaction.
        video
          .play()
          .then(() => updateDebug(dbgVidPlay, 'Playing', 'ok'))
          .catch((error) => {
            console.error('[VIDEO ERROR] Autoplay blocked:', error);
            updateDebug(dbgVidPlay, 'Blocked (Click Video)', 'error');

            // Adds a one-time listener: if the user clicks the video, it tries to play.
            video.addEventListener(
              'click',
              () => {
                video.play();
                video.muted = false; // Tries to unmute after click
              },
              { once: true },
            );
          });
      }
    };
  }

  // Detects actual resolution when the video starts playing
  video.onloadedmetadata = () =>
    updateDebug(dbgVidRes, `${video.videoWidth}x${video.videoHeight}`, 'ok');
  video.onerror = (e) => {
    updateDebug(dbgVidPlay, `Error: ${video.error.code}`, 'error');
    console.error('[VIDEO ELEMENT ERROR]', video.error);
  };
};

/**
 * Sets up the WebRTC PeerConnection specifically for the IP/WebSocket connection flow.
 * Generates the initial offer and sends it directly to the server via WebSocket.
 *
 * @returns {Promise<void>}
 */
const setupIPWebRTC = async () => {
  pc = new RTCPeerConnection({ iceServers: [{ urls: iceServerUrls }] });
  setupWebRTCEvents();

  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ice_candidate', candidate: event.candidate }));
    }
  };

  // Offer Creation (We are the client, so we initiate the connection)
  /** @type {RTCSessionDescriptionInit} */
  const offer = await pc.createOffer({
    offerToReceiveVideo: videoRequested,
    offerToReceiveAudio: audioRequested,
  });

  await pc.setLocalDescription(offer);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'offer', offer: offer }));
  }
};

/**
 * Continuously polls active gamepads using the browser's Gamepad API.
 * Gathers pressed buttons and analog axis data, formats it, and sends it to the server via the DataChannel.
 *
 * @returns {void}
 */
const pollGamepad = () => {
  /** @type {Gamepad[]} */
  const gamepads = navigator.getGamepads();
  /** @type {boolean} */
  const isModalOpen = kbModal.classList.contains('modal-enter');
  /** @type {boolean} */
  const isProfileTab = tabProfileContent.classList.contains('active');
  /** @type {boolean} */
  const isKbTab = tabKbContent.classList.contains('active');
  /** @type {boolean} */
  const isFilterTab = tabFilterContent.classList.contains('active');

  // Raw Input Debugger Engine
  if (isModalOpen && isProfileTab) {
    /** @type {string[]} */
    const debugArr = [];
    for (let i = 0; i < gamepads.length; i++) {
      /** @type {Gamepad | null} */
      const gp = gamepads[i];
      if (gp && gp.connected) {
        /** @type {string[]} */
        const pressed = gp.buttons
          .map((b, idx) => (b.pressed ? idx : -1))
          .filter((v) => v !== -1)
          .map(String);
        /** @type {string[]} */
        const moved = gp.axes
          .map((a, idx) => (Math.abs(a) > 0.1 ? `${idx}: ${a.toFixed(2)}` : null))
          .filter((v) => v);
        debugArr.push(
          `[${gp.index}] ${gp.id} | Btns: ${pressed.length ? pressed.join(', ') : 'none'} | Axes: ${moved.length ? moved.join(', ') : 'idle'}`,
        );
      }
    }
    rawGamepadDebugger.innerHTML = debugArr.length
      ? debugArr.join('<br>')
      : 'Awaiting physical gamepad input...';
  }

  /** @type {Object[]} */
  const padData = [];
  /** @type {string} */
  let debugText = '';
  /** @type {boolean} */
  let padVisualized = false;

  // Iterate ONLY over pads we verified through events
  for (const [index] of activeGamepadsCache.entries()) {
    /** @type {Gamepad | null} */
    const gp = gamepads[index];

    // STRICT CHECK: Ensure the gamepad is actually connected to avoid ghosts
    if (gp && gp.connected) {
      // FILTER CHECK
      if (!isGamepadAllowed(gp)) {
        // If the gamepad has been blocked by the user, it will not be transmitted to the host
        // and will not update the visualizer pad.
        continue;
      }
      // --------------------------------------

      /** @type {{ buttons: {pressed: boolean, value: number}[], axes: number[] }} */
      const mappedData = remapGamepad(gp);

      // Show physical gamepad inputs in the Profile Tab And the Filter Tab
      if (!padVisualized && isModalOpen && (isProfileTab || isFilterTab)) {
        visualizerPad.axes = [...mappedData.axes];
        visualizerPad.buttons = mappedData.buttons.map((b) => ({
          pressed: b.pressed,
          value: b.value,
        }));
        padVisualized = true;
      }

      padData.push({
        index: gp.index + (virtualPad.connected ? 1 : 0),
        buttons: mappedData.buttons,
        axes: mappedData.axes,
      });

      /** @type {number} */
      const activeBtnsCount = mappedData.buttons.reduce(
        (acc, val) => acc + (val.pressed ? 1 : 0),
        0,
      );

      /** @type {string} */
      const lx = mappedData.axes[0]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ly = mappedData.axes[1]?.toFixed(2) || '0.00';
      /** @type {string} */
      const rx = mappedData.axes[2]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ry = mappedData.axes[3]?.toFixed(2) || '0.00';
      /** @type {string} */
      const tx = mappedData.buttons[6].value?.toFixed(2) || '0.00';
      /** @type {string} */
      const ty = mappedData.buttons[7].value?.toFixed(2) || '0.00';

      debugText += `<span style="color:var(--accent-mauve);">Pad [${gp.index}]</span> - Btns Active: ${activeBtnsCount}<br>L: ${lx}, ${ly} | R: ${rx}, ${ry}<br/>T: ${tx}, ${ty}<br><br>`;
    } else {
      // Cleanup ghost disconnections
      activeGamepadsCache.delete(index);
    }
  }

  // Keyboard processing
  if (virtualPad.connected || isKbTab) {
    if (virtualPad.connected) {
      padData.push({ index: virtualPad.index, buttons: virtualPad.buttons, axes: virtualPad.axes });
      /** @type {number} */
      const activeBtnsCount = virtualPad.buttons.reduce(
        (acc, val) => acc + (val.pressed ? 1 : 0),
        0,
      );
      const axesVals = virtualPad.axes;
      const buttonVals = virtualPad.buttons;
      /** @type {string} */
      const lx = axesVals[0]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ly = axesVals[1]?.toFixed(2) || '0.00';
      /** @type {string} */
      const rx = axesVals[2]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ry = axesVals[3]?.toFixed(2) || '0.00';
      /** @type {string} */
      const tx = buttonVals[6].value?.toFixed(2) || '0.00';
      /** @type {string} */
      const ty = buttonVals[7].value?.toFixed(2) || '0.00';

      debugText += `<span style="color:var(--accent-green);">[KB Pad]</span> - Btns Active: ${activeBtnsCount}<br>L: ${lx}, ${ly} | R: ${rx}, ${ry}<br/>T: ${tx}, ${ty}<br>`;
    }

    // Show virtual keyboard inputs ONLY on the Keyboard Tab
    if (!padVisualized && isModalOpen && isKbTab) {
      visualizerPad.axes = [...virtualPad.axes];
      visualizerPad.buttons = virtualPad.buttons.map((b) => ({
        pressed: b.pressed,
        value: b.value,
      }));
      padVisualized = true;
    }
  }

  // Clear the canvas if there are no active controls so it doesn't get locked with hot buttons
  if (!padVisualized && isModalOpen) {
    visualizerPad.axes.fill(0);
    visualizerPad.buttons.forEach((b) => {
      b.pressed = false;
      b.value = 0;
    });
  }

  if (padData.length > 0) {
    updateDebug(dbgPad, `Active Pads: ${padData.length}`, 'ok');
    if (dbgInput && !dbgInput.innerHTML.includes('Limit Reached / Kicked!'))
      dbgInput.innerHTML = debugText;
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'multi_input', pads: padData }));
    }
  } else {
    updateDebug(dbgPad, 'Awaiting Input...', 'warn');
    if (dbgInput && !dbgInput.innerHTML.includes('Limit Reached / Kicked!'))
      dbgInput.textContent = 'Move sticks or press buttons.';
  }

  requestAnimationFrame(pollGamepad);
};

requestAnimationFrame(pollGamepad);
btnConnect.addEventListener('click', initConnection);

/**
 * Initializes the theme system. Checks for saved user preference or matches
 * the browser's default color scheme. Sets up the toggle button listener.
 *
 * @returns {void}
 */
const initTheme = () => {
  /** @type {string | null} */
  const savedTheme = localStorage.getItem('pony_theme');

  // Change HTML Theme Color meta tag
  const updateMetaTheme = (theme) => {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#8839ef' : '#cba6f7');
  };

  // Apply saved theme if it exists
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateMetaTheme(savedTheme);
  }

  btnToggleTheme.addEventListener('click', () => {
    /** @type {string | null} */
    const currentTheme = document.documentElement.getAttribute('data-theme');

    /** @type {boolean} */
    const isSystemLight = window.matchMedia('(prefers-color-scheme: light)').matches;

    /** @type {string} */
    let newTheme = 'dark';

    // Determine the next theme state
    if (currentTheme === 'light') {
      newTheme = 'dark';
    } else if (currentTheme === 'dark') {
      newTheme = 'light';
    } else {
      // If no override is set, invert the current system preference
      newTheme = isSystemLight ? 'dark' : 'light';
    }

    // Apply and save
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('pony_theme', newTheme);

    updateMetaTheme(newTheme);
    updateCanvasColors();
  });

  updateCanvasColors();
};

// Execute theme initialization
initTheme();
initLatencyController();
