/** @type {HTMLVideoElement} */
const video = document.getElementById('streamView');
/** @type {HTMLInputElement} */
const serverInput = document.getElementById('serverHost');
/** @type {HTMLInputElement} */
const passInput = document.getElementById('pass');
/** @type {HTMLButtonElement} */
const btnConnect = document.getElementById('btnConnect');
/** @type {HTMLElement} */
const loginDiv = document.getElementById('login');
/** @type {HTMLButtonElement} */
const btnToggleDebug = document.getElementById('btnToggleDebug');
/** @type {HTMLElement} */
const debugPanel = document.getElementById('debugPanel');
/** @type {HTMLInputElement} */
const wantsAudioInput = document.getElementById('wantsAudio');
/** @type {HTMLInputElement} */
const wantsVideoInput = document.getElementById('wantsVideo');
/** @type {HTMLInputElement} */
const stunInput = document.getElementById('stunServer');
/** @type {HTMLSelectElement} */
const connMethodSelect = document.getElementById('connectionMethod');
/** @type {HTMLElement} */
const ipSection = document.getElementById('ipSection');
/** @type {HTMLElement} */
const sdpSection = document.getElementById('manualClientSection');
/** @type {HTMLElement} */
const clientIdHud = document.getElementById('clientIdHud');
/** @type {HTMLElement} */
const dbgPing = document.getElementById('dbgPing');

// Keyboard Gamepad UI
/** @type {HTMLInputElement} */
const useKbPadInput = document.getElementById('useKbPad');
/** @type {HTMLButtonElement} */
const btnOpenKbConfig = document.getElementById('btnOpenKbConfig');
/** @type {HTMLElement} */
const kbModal = document.getElementById('kbModal');
/** @type {HTMLCanvasElement} */
const gamepadCanvas = document.getElementById('gamepadCanvas');
/** @type {HTMLElement} */
const kbMappings = document.getElementById('kbMappings');
/** @type {HTMLButtonElement} */
const btnCloseKb = document.getElementById('btnCloseKb');
/** @type {HTMLButtonElement} */
const btnExportKb = document.getElementById('btnExportKb');
/** @type {HTMLButtonElement} */
const btnImportKbBtn = document.getElementById('btnImportKbBtn');
/** @type {HTMLInputElement} */
const btnImportKbFile = document.getElementById('btnImportKbFile');
/** @type {HTMLButtonElement} */
const btnOpenTx = document.getElementById('btnOpenTx');

// Debug Elements
/** @type {HTMLElement} */
const dbgWs = document.getElementById('dbgWs');
/** @type {HTMLElement} */
const dbgRtcConn = document.getElementById('dbgRtcConn');
/** @type {HTMLElement} */
const dbgRtcIce = document.getElementById('dbgRtcIce');
/** @type {HTMLElement} */
const dbgVidTrack = document.getElementById('dbgVidTrack');
/** @type {HTMLElement} */
const dbgVidPlay = document.getElementById('dbgVidPlay');
/** @type {HTMLElement} */
const dbgVidRes = document.getElementById('dbgVidRes');
/** @type {HTMLElement} */
const dbgDc = document.getElementById('dbgDc');
/** @type {HTMLElement} */
const dbgPad = document.getElementById('dbgPad');
/** @type {HTMLElement} */
const dbgInput = document.getElementById('dbgInput');

/** @type {NodeJS.Timeout | null} */
let notificationTimer = null;

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

// --- KEYBOARD EMULATOR LOGIC ---

/**
 * @typedef {Object} VirtualGamepadConfig
 * @property {boolean} connected
 * @property {number} index
 * @property {number[]} axes
 * @property {{pressed: boolean, value: number}[]} buttons
 */

/** @type {VirtualGamepadConfig} */
const virtualPad = {
  connected: false,
  index: 0,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};

/**
 * @typedef {Object} KeyMapAction
 * @property {string} name
 * @property {'button'|'axis'} type
 * @property {number} index
 * @property {number} [val]
 */

/** @type {Record<string, KeyMapAction>} */
const defaultActionMap = {
  btnA: { name: 'A Button', type: 'button', index: 0 },
  btnB: { name: 'B Button', type: 'button', index: 1 },
  btnX: { name: 'X Button', type: 'button', index: 2 },
  btnY: { name: 'Y Button', type: 'button', index: 3 },
  btnLB: { name: 'Left Bumper', type: 'button', index: 4 },
  btnRB: { name: 'Right Bumper', type: 'button', index: 5 },
  btnLT: { name: 'Left Trigger', type: 'button', index: 6 },
  btnRT: { name: 'Right Trigger', type: 'button', index: 7 },
  btnSelect: { name: 'Select', type: 'button', index: 8 },
  btnStart: { name: 'Start', type: 'button', index: 9 },
  dUp: { name: 'D-Pad Up', type: 'button', index: 12 },
  dDown: { name: 'D-Pad Down', type: 'button', index: 13 },
  dLeft: { name: 'D-Pad Left', type: 'button', index: 14 },
  dRight: { name: 'D-Pad Right', type: 'button', index: 15 },
  lsUp: { name: 'LS Up', type: 'axis', index: 1, val: -1 },
  lsDown: { name: 'LS Down', type: 'axis', index: 1, val: 1 },
  lsLeft: { name: 'LS Left', type: 'axis', index: 0, val: -1 },
  lsRight: { name: 'LS Right', type: 'axis', index: 0, val: 1 },
  rsUp: { name: 'RS Up', type: 'axis', index: 3, val: -1 },
  rsDown: { name: 'RS Down', type: 'axis', index: 3, val: 1 },
  rsLeft: { name: 'RS Left', type: 'axis', index: 2, val: -1 },
  rsRight: { name: 'RS Right', type: 'axis', index: 2, val: 1 },
};

/** @type {Record<string, string>} */
let currentKeyBinds = {
  btnA: 'KeyK',
  btnB: 'KeyL',
  btnX: 'KeyJ',
  btnY: 'KeyI',
  dUp: 'ArrowUp',
  dDown: 'ArrowDown',
  dLeft: 'ArrowLeft',
  dRight: 'ArrowRight',
  lsUp: 'KeyW',
  lsDown: 'KeyS',
  lsLeft: 'KeyA',
  lsRight: 'KeyD',
  btnStart: 'Enter',
  btnSelect: 'ShiftRight',
};

/** @type {Set<string>} */
const pressedKeys = new Set();
/** @type {string|null} */
let awaitingBind = null;
/** @type {number|null} */
let animFrameId = null;

/**
 * @returns {void}
 */
const generateKbUI = () => {
  kbMappings.innerHTML = '';
  Object.keys(defaultActionMap).forEach((actionId) => {
    const action = defaultActionMap[actionId];
    const bindBtn = document.createElement('button');
    bindBtn.textContent = currentKeyBinds[actionId] || 'Unbound';
    bindBtn.onclick = () => {
      if (awaitingBind) return;
      awaitingBind = actionId;
      bindBtn.textContent = 'Press Key...';
    };

    const wrapper = document.createElement('div');
    wrapper.className = 'kb-map-item';
    wrapper.innerHTML = `<span>${action.name}</span>`;
    wrapper.appendChild(bindBtn);
    kbMappings.appendChild(wrapper);
  });
};

/**
 * @returns {void}
 */
const drawGamepadCanvas = () => {
  if (kbModal.style.display === 'none') return;

  const ctx = gamepadCanvas.getContext('2d');
  ctx.clearRect(0, 0, 300, 180);

  // Draw Body
  const drawRect = (x, y, w, h, r, pressed) => {
    ctx.fillStyle = pressed ? '#cba6f7' : '#45475a';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };

  const drawBtn = (x, y, r, pressed) => {
    ctx.fillStyle = pressed ? '#cba6f7' : '#45475a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Triggers (LT / RT)
  drawRect(60, 10, 40, 20, 5, virtualPad.buttons[6].pressed);
  drawRect(200, 10, 40, 20, 5, virtualPad.buttons[7].pressed);

  // Bumpers (LB / RB)
  drawRect(50, 35, 60, 15, 5, virtualPad.buttons[4].pressed);
  drawRect(190, 35, 60, 15, 5, virtualPad.buttons[5].pressed);

  // Body
  ctx.fillStyle = '#313244';
  ctx.beginPath();
  ctx.roundRect(40, 50, 220, 90, 40);
  ctx.fill();

  // Select / Start
  drawRect(130, 70, 15, 8, 4, virtualPad.buttons[8].pressed);
  drawRect(155, 70, 15, 8, 4, virtualPad.buttons[9].pressed);

  // ABXY (+20 Y Offset)
  drawBtn(230, 100, 8, virtualPad.buttons[0].pressed); // A
  drawBtn(250, 80, 8, virtualPad.buttons[1].pressed); // B
  drawBtn(210, 80, 8, virtualPad.buttons[2].pressed); // X
  drawBtn(230, 60, 8, virtualPad.buttons[3].pressed); // Y

  // D-Pad (+20 Y Offset)
  drawBtn(70, 80, 8, virtualPad.buttons[12].pressed); // Up
  drawBtn(70, 110, 8, virtualPad.buttons[13].pressed); // Down
  drawBtn(55, 95, 8, virtualPad.buttons[14].pressed); // Left
  drawBtn(85, 95, 8, virtualPad.buttons[15].pressed); // Right

  // Sticks (+20 Y Offset)
  ctx.fillStyle = '#45475a';
  ctx.beginPath();
  ctx.arc(110, 100, 15, 0, Math.PI * 2);
  ctx.fill();
  drawBtn(
    110 + virtualPad.axes[0] * 10,
    100 + virtualPad.axes[1] * 10,
    8,
    virtualPad.buttons[10]?.pressed || virtualPad.axes[0] !== 0 || virtualPad.axes[1] !== 0,
  );

  ctx.fillStyle = '#45475a';
  ctx.beginPath();
  ctx.arc(190, 100, 15, 0, Math.PI * 2);
  ctx.fill();
  drawBtn(
    190 + virtualPad.axes[2] * 10,
    100 + virtualPad.axes[3] * 10,
    8,
    virtualPad.buttons[11]?.pressed || virtualPad.axes[2] !== 0 || virtualPad.axes[3] !== 0,
  );

  animFrameId = requestAnimationFrame(drawGamepadCanvas);
};

/**
 * @param {string} code
 * @param {boolean} isDown
 * @returns {void}
 */
const handleVirtualInput = (code, isDown) => {
  if (isDown) pressedKeys.add(code);
  else pressedKeys.delete(code);

  virtualPad.axes.fill(0);
  virtualPad.buttons.forEach((b) => {
    b.pressed = false;
    b.value = 0;
  });

  for (const key of pressedKeys) {
    // Find all actions mapped to this key
    const mappedActions = Object.entries(currentKeyBinds)
      .filter(([, k]) => k === key)
      .map(([a]) => a);

    mappedActions.forEach((actionId) => {
      const config = defaultActionMap[actionId];
      if (config.type === 'button') {
        virtualPad.buttons[config.index].pressed = true;
        virtualPad.buttons[config.index].value = 1;
      } else if (config.type === 'axis') {
        virtualPad.axes[config.index] += config.val;
      }
    });
  }

  for (let i = 0; i < 4; i++) {
    virtualPad.axes[i] = Math.max(-1, Math.min(1, virtualPad.axes[i]));
  }
};

window.addEventListener('keydown', (e) => {
  if (awaitingBind) {
    e.preventDefault();
    currentKeyBinds[awaitingBind] = e.code;
    awaitingBind = null;
    generateKbUI();
    return;
  }
  handleVirtualInput(e.code, true);
});

window.addEventListener('keyup', (e) => {
  handleVirtualInput(e.code, false);
});

btnOpenKbConfig.addEventListener('click', () => {
  kbModal.style.display = 'flex';
  generateKbUI();
  drawGamepadCanvas();
});

btnCloseKb.addEventListener('click', () => {
  kbModal.style.display = 'none';
  if (animFrameId) cancelAnimationFrame(animFrameId);
  localStorage.setItem('pony_kb_binds', JSON.stringify(currentKeyBinds));
});

btnExportKb.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(currentKeyBinds, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tiny_pony_kb_map.json';
  a.click();
});

btnImportKbBtn.addEventListener('click', () => btnImportKbFile.click());

btnImportKbFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      currentKeyBinds = JSON.parse(evt.target.result);
      generateKbUI();
    } catch (err) {
      alert('Invalid JSON format!');
    }
  };
  reader.readAsText(file);
});

useKbPadInput.addEventListener('change', (e) => {
  virtualPad.connected = e.target.checked;
  localStorage.setItem('pony_use_kb', e.target.checked.toString());
});

wantsVideoInput.addEventListener('change', (e) => {
  localStorage.setItem('pony_wants_video', e.target.checked.toString());
});

wantsAudioInput.addEventListener('change', (e) => {
  localStorage.setItem('pony_wants_audio', e.target.checked.toString());
});

// --- POPUP TRANSMITTER ---

btnOpenTx.addEventListener('click', () => {
  const popupHtml = `<!DOCTYPE html><html><head><title>Input Transmitter</title><style>body{background:#1e1e2e;color:#cba6f7;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;}h3{margin:0;}</style></head><body><div><h3>Transmitter Active</h3><p>Keep this window focused to send keyboard inputs to Tiny Pony Stream.</p></div><script>['keydown','keyup'].forEach(evt=>{window.addEventListener(evt,e=>{e.preventDefault();if(window.opener){window.opener.postMessage({type:'kb_event',event:evt,code:e.code},'*');}});});</script></body></html>`;
  const blob = new Blob([popupHtml], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), 'InputTransmitter', 'width=350,height=250');
});

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'kb_event') {
    handleVirtualInput(e.data.code, e.data.event === 'keydown');
  }
});

// --- MAIN APPLICATION RESTORE ---

// --- DOM Event Listeners for Manual SDP ---

/** @type {HTMLButtonElement} */
const generateOfferBtn = document.getElementById('generateOfferBtn');

/** @type {HTMLTextAreaElement} */
const myOfferOutput = document.getElementById('myOfferOutput');

/** @type {HTMLButtonElement} */
const connectManualBtn = document.getElementById('connectManualBtn');

/** @type {HTMLTextAreaElement} */
const serverAnswerInput = document.getElementById('serverAnswerInput');

generateOfferBtn.addEventListener('click', async () => {
  checkMediaPreferences();
  myOfferOutput.value = 'Gathering ICE candidates...';

  /** @type {RTCConfiguration} */
  const rtcConfig = { iceServers: [{ urls: iceServerUrls }] };

  /** @type {string} */
  const offerString = await generateClientOffer(rtcConfig);

  // Encodes the offer to Base64 before displaying it on screen
  myOfferOutput.value = btoa(offerString);
  updateDebug(dbgWs, 'Manual SDP Ready', 'ok');
});

connectManualBtn.addEventListener('click', async () => {
  /** @type {string} */
  const b64Answer = serverAnswerInput.value.trim();

  if (b64Answer) {
    /** @type {string} */
    let answerStr = '';

    try {
      answerStr = atob(b64Answer);
      // Checks if it decoded into a valid JSON
      JSON.parse(answerStr);
    } catch (e) {
      alert('Invalid Base64 format! Please ensure you copied the exact code the server gave you.');
      return;
    }

    await applyServerAnswer(answerStr);
    console.log('[CLIENT] Connected via manual signaling!');
    loginDiv.style.display = 'none';
    document.body.classList.add('is-playing');
    btnOpenTx.style.display = 'block';
    if (videoRequested) video.style.display = 'block';
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
  const cachedBinds = localStorage.getItem('pony_kb_binds');

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

  if (cachedBinds) {
    try {
      currentKeyBinds = JSON.parse(cachedBinds);
    } catch (e) {}
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
  if (e.key === 'F2') {
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
  // Uses the current browser port for the WebSocket
  checkMediaPreferences();
  localStorage.setItem('pony_stream_stun', stunInput.value.trim());

  /** @type {string} */
  let host = !serverInput.disabled ? serverInput.value.trim() : `ws://${window.location.host}`;

  if (!host) {
    alert('Please provide a server IP or address.');
    return;
  }
  if (!host.startsWith('ws://') && !host.startsWith('wss://')) host = `ws://${host}`;

  updateDebug(dbgWs, 'Connecting...', 'warn');
  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';

  try {
    ws = new WebSocket(host);
  } catch (err) {
    updateDebug(dbgWs, 'Invalid URL', 'error');
    alert('Invalid server address format.');
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
  };

  ws.onerror = () => updateDebug(dbgWs, 'Error', 'error');

  ws.onmessage = async (event) => {
    /** @type {Object} */
    const data = JSON.parse(event.data);

    if (data.type === 'auth_success') {
      if (data.clientId) {
        clientIdHud.style.display = 'block';
        document.getElementById('myClientId').textContent = data.clientId;
      }

      // Saves to cache
      localStorage.setItem('pony_stream_pass', passInput.value);

      updateDebug(dbgWs, 'Connected', 'ok');
      loginDiv.style.display = 'none';
      document.body.classList.add('is-playing');
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
    } else if (data.type === 'auth_error') {
      updateDebug(dbgWs, 'Auth Failed', 'error');
      alert('Wrong password!');
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
      dbgInput.innerHTML += `<br><span style="color:#f38ba8; font-weight:bold;">${data.message}</span>`;
      showDisconnectNotification(`Host Message: ${data.message}`);
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
      showDisconnectNotification(`Host Message: ${msg.message}`);
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

    if (s === 'disconnected' || s === 'failed')
      showDisconnectNotification('Lost connection to host.');
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

      if (video.srcObject !== event.streams[0]) {
        video.srcObject = event.streams[0];

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

  requestAnimationFrame(pollGamepad);
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

// --- EFFICIENT POLLING WITH CACHE ---

/**
 * Continuously polls active gamepads using the browser's Gamepad API.
 * Gathers pressed buttons and analog axis data, formats it, and sends it to the server via the DataChannel.
 *
 * @returns {void}
 */
const pollGamepad = () => {
  /** @type {Gamepad[]} */
  const gamepads = navigator.getGamepads();
  /** @type {Object[]} */
  const padData = [];
  /** @type {string} */
  let debugText = '';

  // Iterate ONLY over pads we verified through events
  for (const [index] of activeGamepadsCache.entries()) {
    /** @type {Gamepad | null} */
    const gp = gamepads[index];

    // STRICT CHECK: Ensure the gamepad is actually connected to avoid ghosts
    if (gp && gp.connected) {
      /** @type {Object[]} */
      const buttonsData = gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value }));
      /** @type {number[]} */
      const axesVals = gp.axes;

      padData.push({
        index: gp.index + (virtualPad.connected ? 1 : 0),
        buttons: buttonsData,
        axes: axesVals,
      });

      /** @type {number} */
      const activeBtnsCount = buttonsData.reduce((acc, val) => acc + (val.pressed ? 1 : 0), 0);
      /** @type {string} */
      const lx = axesVals[0]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ly = axesVals[1]?.toFixed(2) || '0.00';
      /** @type {string} */
      const rx = axesVals[2]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ry = axesVals[3]?.toFixed(2) || '0.00';

      debugText += `<span style="color:#cba6f7;">Pad [${gp.index}]</span> - Btns Active: ${activeBtnsCount}<br>L: ${lx}, ${ly} | R: ${rx}, ${ry}<br><br>`;
    } else {
      // Cleanup ghost disconnections
      activeGamepadsCache.delete(index);
    }
  }

  // Inject Virtual Keyboard Pad
  if (virtualPad.connected) {
    padData.push({ index: virtualPad.index, buttons: virtualPad.buttons, axes: virtualPad.axes });
    const activeBtnsCount = virtualPad.buttons.reduce((acc, val) => acc + (val.pressed ? 1 : 0), 0);
    debugText += `<span style="color:#a6e3a1;">[KB Pad]</span> - Btns Active: ${activeBtnsCount}<br>`;
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

btnConnect.addEventListener('click', initConnection);
