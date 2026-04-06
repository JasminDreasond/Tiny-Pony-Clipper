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
  btnOpenKbConfig,
  kbModal,
  gamepadCanvas,
  kbMappings,
  btnCloseKb,
  btnExportKb,
  btnImportKbBtn,
  btnImportKbFile,
  btnOpenTx,
  btnCancelKb,
  btnResetKb,

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
  tabKbBtn,
  tabProfileBtn,
  tabKbContent,
  tabProfileContent,

  // Profile Manager Elements
  profileSelect,
  btnCreateProfile,
  btnCloneProfile,
  btnDeleteProfile,
  profileName,
  profileRegex,
  profileButtonsGrid,
  profileAxesGrid,
  rawGamepadDebugger,
  btnExportProfile,
  btnImportProfileBtn,
  btnImportProfileFile,
  btnSaveProfile,
} from './html.js';
import { showAlert, openModal, closeModal } from './Modal.js';
import { sendBackgroundNotification } from './Notification.js';
import { resolveApiConnection, setAuthenticating, setGenerateOfferCallback } from './pageApi.js';
import { startPlayTimer, stopPlayTimer, bypassWelcome } from './Welcome.js';

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

// --- MODAL TAB LOGIC ---

/**
 * @param {HTMLElement} btn
 * @param {HTMLElement} content
 * @returns {void}
 */
const switchTab = (btn, content) => {
  tabKbBtn.classList.remove('active');
  tabProfileBtn.classList.remove('active');
  tabKbContent.classList.remove('active');
  tabProfileContent.classList.remove('active');

  btn.classList.add('active');
  content.classList.add('active');
};

tabKbBtn.addEventListener('click', () => switchTab(tabKbBtn, tabKbContent));
tabProfileBtn.addEventListener('click', () => switchTab(tabProfileBtn, tabProfileContent));

// --- GAMEPAD PROFILES MANAGER LOGIC ---

/**
 * @typedef {Object} GamepadProfile
 * @property {string} name
 * @property {string} regex
 * @property {number[]} buttons
 * @property {number[]} axes
 * @property {boolean} [readonly]
 */

/** @type {Record<string, GamepadProfile>} */
const defaultProfiles = {
  gamecube: {
    name: 'GameCube Adapter',
    regex: 'gamecube|mayflash',
    // [A, B, X, Y, LB, RB, LT, RT, Select, Start, L3, R3, Up, Down, Left, Right, Home]
    // Replace these indices with the correct ones fired by your GameCube adapter
    buttons: [1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    axes: [0, 1, 2, 3],
    readonly: true,
  },
};

/** @type {Record<string, GamepadProfile>} */
let customProfiles = JSON.parse(localStorage.getItem('pony_gamepad_profiles') || '{}');

/**
 * @returns {void}
 */
const saveCustomProfiles = () => {
  localStorage.setItem('pony_gamepad_profiles', JSON.stringify(customProfiles));
};

/**
 * @returns {void}
 */
const renderProfileDropdown = () => {
  /** @type {string} */
  const currentValue = profileSelect.value;
  profileSelect.innerHTML = '';

  const optGroupDefault = document.createElement('optgroup');
  optGroupDefault.label = 'Default Profiles';
  Object.keys(defaultProfiles).forEach((k) => {
    const opt = document.createElement('option');
    opt.value = `default_${k}`;
    opt.textContent = defaultProfiles[k].name;
    optGroupDefault.appendChild(opt);
  });
  profileSelect.appendChild(optGroupDefault);

  const optGroupCustom = document.createElement('optgroup');
  optGroupCustom.label = 'Custom Profiles';
  Object.keys(customProfiles).forEach((k) => {
    const opt = document.createElement('option');
    opt.value = `custom_${k}`;
    opt.textContent = customProfiles[k].name;
    optGroupCustom.appendChild(opt);
  });
  profileSelect.appendChild(optGroupCustom);

  if (currentValue && profileSelect.querySelector(`option[value="${currentValue}"]`)) {
    profileSelect.value = currentValue;
  } else {
    profileSelect.selectedIndex = 0;
  }
};

/**
 * @param {string} val
 * @returns {{ type: 'default' | 'custom', key: string }}
 */
const parseProfileVal = (val) => {
  if (val.startsWith('default_')) return { type: 'default', key: val.replace('default_', '') };
  return { type: 'custom', key: val.replace('custom_', '') };
};

/**
 * @returns {void}
 */
const renderProfileEditor = () => {
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(profileSelect.value);

  /** @type {GamepadProfile | null} */
  const profile =
    parsed.type === 'default' ? defaultProfiles[parsed.key] : customProfiles[parsed.key];
  if (!profile) return;

  /** @type {boolean} */
  const isReadonly = !!profile.readonly;

  profileName.value = profile.name;
  profileRegex.value = profile.regex;
  profileName.disabled = isReadonly;
  profileRegex.disabled = isReadonly;

  btnSaveProfile.disabled = isReadonly;
  btnDeleteProfile.disabled = isReadonly;

  profileButtonsGrid.innerHTML = '';
  for (let i = 0; i <= 16; i++) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '32';
    input.value = profile.buttons[i] !== undefined ? profile.buttons[i].toString() : i.toString();
    input.disabled = isReadonly;
    input.dataset.idx = i.toString();
    profileButtonsGrid.appendChild(input);
  }

  profileAxesGrid.innerHTML = '';
  for (let i = 0; i <= 3; i++) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '8';
    input.value = profile.axes[i] !== undefined ? profile.axes[i].toString() : i.toString();
    input.disabled = isReadonly;
    input.dataset.idx = i.toString();
    profileAxesGrid.appendChild(input);
  }
};

profileSelect.addEventListener('change', renderProfileEditor);

btnCreateProfile.addEventListener('click', () => {
  /** @type {string} */
  const newKey = `custom_${Date.now()}`;

  customProfiles[newKey] = {
    name: 'New Profile',
    regex: '.*', // Capture any control by default until user changes
    buttons: Array.from({ length: 17 }, (_, i) => i), // 0 to 16 mapped in original order
    axes: [0, 1, 2, 3], // Axis in original order
  };

  saveCustomProfiles();
  renderProfileDropdown();
  profileSelect.value = `custom_${newKey}`;
  renderProfileEditor();
});

btnCloneProfile.addEventListener('click', () => {
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(profileSelect.value);
  /** @type {GamepadProfile | null} */
  const srcProfile =
    parsed.type === 'default' ? defaultProfiles[parsed.key] : customProfiles[parsed.key];
  if (!srcProfile) return;

  /** @type {string} */
  const newKey = `clone_${Date.now()}`;
  customProfiles[newKey] = {
    name: `${srcProfile.name} (Clone)`,
    regex: srcProfile.regex,
    buttons: [...srcProfile.buttons],
    axes: [...srcProfile.axes],
  };

  saveCustomProfiles();
  renderProfileDropdown();
  profileSelect.value = `custom_${newKey}`;
  renderProfileEditor();
});

btnSaveProfile.addEventListener('click', () => {
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(profileSelect.value);
  if (parsed.type === 'default') return;

  /** @type {number[]} */
  const newBtns = Array.from(profileButtonsGrid.querySelectorAll('input')).map((inp) =>
    parseInt(inp.value, 10),
  );
  /** @type {number[]} */
  const newAxes = Array.from(profileAxesGrid.querySelectorAll('input')).map((inp) =>
    parseInt(inp.value, 10),
  );

  customProfiles[parsed.key] = {
    name: profileName.value.trim() || 'Unnamed Profile',
    regex: profileRegex.value.trim() || '.*',
    buttons: newBtns,
    axes: newAxes,
  };

  saveCustomProfiles();
  renderProfileDropdown();
  profileSelect.value = `custom_${parsed.key}`;
  showAlert('Profile saved successfully!');
});

btnDeleteProfile.addEventListener('click', () => {
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(profileSelect.value);
  if (parsed.type === 'default') return;

  delete customProfiles[parsed.key];
  saveCustomProfiles();
  renderProfileDropdown();
  renderProfileEditor();
});

btnExportProfile.addEventListener('click', () => {
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(profileSelect.value);
  /** @type {GamepadProfile | null} */
  const profile =
    parsed.type === 'default' ? defaultProfiles[parsed.key] : customProfiles[parsed.key];

  if (!profile) return;

  /** @type {Object} */
  const exportObj = { [parsed.key]: profile };
  /** @type {Blob} */
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  /** @type {HTMLAnchorElement} */
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tiny_pony_profile_${parsed.key}.json`;
  a.click();
});

btnImportProfileBtn.addEventListener('click', () => btnImportProfileFile.click());

btnImportProfileFile.addEventListener('change', (e) => {
  /** @type {File} */
  const file = e.target.files[0];
  if (!file) return;
  /** @type {FileReader} */
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      /** @type {Object} */
      const importedData = JSON.parse(evt.target.result);
      Object.keys(importedData).forEach((k) => {
        /** @type {GamepadProfile} */
        const p = importedData[k];
        if (p && p.name && p.buttons && p.axes) {
          p.readonly = false; // Always force imports to be editable
          customProfiles[k] = p;
        }
      });
      saveCustomProfiles();
      renderProfileDropdown();
      showAlert('Profile(s) imported successfully!');
    } catch (err) {
      showAlert('Invalid JSON profile format!');
    }
  };
  reader.readAsText(file);
});

// --- KEYBOARD EMULATOR LOGIC ---

/**
 * @typedef {Object} VisualizerPadState
 * @property {number[]} axes
 * @property {{pressed: boolean, value: number}[]} buttons
 */

/** @type {VisualizerPadState} */
const visualizerPad = {
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};

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
 * @property {string} icon
 * @property {string} name
 * @property {'button'|'axis'} type
 * @property {number} index
 * @property {number} [val]
 */

/** @type {Record<string, KeyMapAction>} */
const defaultActionMap = {
  // Buttons - Standardized to non-color versions for consistency
  btnA: {
    icon: 'img/kenney_input_xbox_series/xbox_button_a.png',
    name: 'A Button',
    type: 'button',
    index: 0,
  },
  btnB: {
    icon: 'img/kenney_input_xbox_series/xbox_button_b.png',
    name: 'B Button',
    type: 'button',
    index: 1,
  },
  btnX: {
    icon: 'img/kenney_input_xbox_series/xbox_button_x.png',
    name: 'X Button',
    type: 'button',
    index: 2,
  },
  btnY: {
    icon: 'img/kenney_input_xbox_series/xbox_button_y.png',
    name: 'Y Button',
    type: 'button',
    index: 3,
  },

  // Bumpers and Triggers
  btnLB: {
    icon: 'img/kenney_input_xbox_series/xbox_lb.png',
    name: 'Left Bumper',
    type: 'button',
    index: 4,
  },
  btnRB: {
    icon: 'img/kenney_input_xbox_series/xbox_rb.png',
    name: 'Right Bumper',
    type: 'button',
    index: 5,
  },
  btnLT: {
    icon: 'img/kenney_input_xbox_series/xbox_lt.png',
    name: 'Left Trigger',
    type: 'button',
    index: 6,
  },
  btnRT: {
    icon: 'img/kenney_input_xbox_series/xbox_rt.png',
    name: 'Right Trigger',
    type: 'button',
    index: 7,
  },

  // System Buttons
  btnSelect: {
    icon: 'img/kenney_input_xbox_series/xbox_button_back.png',
    name: 'Select',
    type: 'button',
    index: 8,
  },
  btnStart: {
    icon: 'img/kenney_input_xbox_series/xbox_button_start.png',
    name: 'Start',
    type: 'button',
    index: 9,
  },
  btnL3: {
    icon: 'img/kenney_input_xbox_series/xbox_ls.png',
    name: 'LS Click',
    type: 'button',
    index: 10,
  },
  btnR3: {
    icon: 'img/kenney_input_xbox_series/xbox_rs.png',
    name: 'RS Click',
    type: 'button',
    index: 11,
  },

  // D-Pad
  dUp: {
    icon: 'img/kenney_input_xbox_series/xbox_dpad_up.png',
    name: 'D-Pad Up',
    type: 'button',
    index: 12,
  },
  dDown: {
    icon: 'img/kenney_input_xbox_series/xbox_dpad_down.png',
    name: 'D-Pad Down',
    type: 'button',
    index: 13,
  },
  dLeft: {
    icon: 'img/kenney_input_xbox_series/xbox_dpad_left.png',
    name: 'D-Pad Left',
    type: 'button',
    index: 14,
  },
  dRight: {
    icon: 'img/kenney_input_xbox_series/xbox_dpad_right.png',
    name: 'D-Pad Right',
    type: 'button',
    index: 15,
  },

  // Left Stick Axes
  lsUp: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_l_up.png',
    name: 'LS Up',
    type: 'axis',
    index: 1,
    val: -1,
  },
  lsDown: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_l_down.png',
    name: 'LS Down',
    type: 'axis',
    index: 1,
    val: 1,
  },
  lsLeft: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_l_left.png',
    name: 'LS Left',
    type: 'axis',
    index: 0,
    val: -1,
  },
  lsRight: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_l_right.png',
    name: 'LS Right',
    type: 'axis',
    index: 0,
    val: 1,
  },

  // Right Stick Axes
  rsUp: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_r_up.png',
    name: 'RS Up',
    type: 'axis',
    index: 3,
    val: -1,
  },
  rsDown: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_r_down.png',
    name: 'RS Down',
    type: 'axis',
    index: 3,
    val: 1,
  },
  rsLeft: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_r_left.png',
    name: 'RS Left',
    type: 'axis',
    index: 2,
    val: -1,
  },
  rsRight: {
    icon: 'img/kenney_input_xbox_series/xbox_stick_r_right.png',
    name: 'RS Right',
    type: 'axis',
    index: 2,
    val: 1,
  },
};

/** @type {Record<string, string>} */
const DEFAULT_KEY_BINDS = {
  btnA: 'KeyK',
  btnB: 'KeyL',
  btnX: 'KeyJ',
  btnY: 'KeyI',
  btnLB: 'KeyU',
  btnRB: 'KeyO',
  btnLT: 'Digit7',
  btnRT: 'Digit8',
  btnL3: 'KeyQ',
  btnR3: 'KeyE',
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
  rsUp: 'Numpad8',
  rsDown: 'Numpad2',
  rsLeft: 'Numpad4',
  rsRight: 'Numpad6',
};

/** @type {Record<string, string>} */
let currentKeyBinds = { ...DEFAULT_KEY_BINDS };
/** @type {Record<string, string>} */
let backupKeyBinds = {};

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
    wrapper.innerHTML = `${action.icon ? `<img class='kb-map-icon' src="${action.icon}" alt="${action.name}" /> ` : ''}<span>${action.name}</span>`;
    wrapper.appendChild(bindBtn);
    kbMappings.appendChild(wrapper);
  });
};

/**
 * @returns {void}
 */
const drawGamepadCanvas = () => {
  if (!kbModal.classList.contains('modal-enter')) return;

  /** @type {HTMLCanvasElement} */
  const canvas = gamepadCanvas;

  /** @type {CanvasRenderingContext2D} */
  const ctx = gamepadCanvas.getContext('2d');

  ctx.clearRect(0, 0, 300, 180);

  /**
   * Catppuccin Palette
   * @type {{
   * bodyBase: string,
   * bodyTop: string,
   * btnBase: string,
   * btnPressed: string,
   * shadow: string,
   * glow: string,
   * bgBase: string
   * }}
   */
  const colors = {
    bodyBase: '#1e1e2e', // Darker Base (Mocha)
    bodyTop: '#313244', // Surface (Surface 0)
    btnBase: '#45475a', // Button (Surface 1)
    btnPressed: '#cba6f7', // Pressed (Mauve)
    shadow: 'rgba(0, 0, 0, 0.4)',
    glow: 'rgba(203, 166, 247, 0.6)', // Mauve Brightness
    bgBase: '#181825', // Cavity (Crust)
  };

  /**
   * Reusable style functions
   * @param {boolean} pressed
   * @returns {void}
   */
  const applyGlowOrShadow = (pressed) => {
    ctx.shadowColor = pressed ? colors.glow : colors.shadow;
    ctx.shadowBlur = pressed ? 12 : 5; // Bright glow if pressed
    ctx.shadowOffsetY = pressed ? 0 : 3; // Depth if not pressed
    ctx.shadowOffsetX = 0;
  };

  /**
   * @returns {void}
   */
  const resetShadow = () => {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number|number[]} r
   * @param {boolean} pressed
   * @returns {void}
   */
  const drawShapeRect = (x, y, w, h, r, pressed) => {
    ctx.fillStyle = pressed ? colors.btnPressed : colors.btnBase;
    applyGlowOrShadow(pressed);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    resetShadow();
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} r
   * @param {boolean} pressed
   * @returns {void}
   */
  const drawShapeBtn = (x, y, r, pressed) => {
    ctx.fillStyle = pressed ? colors.btnPressed : colors.btnBase;
    applyGlowOrShadow(pressed);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    resetShadow();
  };

  /**
   * @param {number} baseX
   * @param {number} baseY
   * @param {number} offsetX
   * @param {number} offsetY
   * @param {boolean} pressed
   * @returns {void}
   */
  const drawAnalogStick = (baseX, baseY, offsetX, offsetY, pressed) => {
    // Stick Base Cavity
    ctx.fillStyle = colors.bgBase;
    ctx.beginPath();
    ctx.arc(baseX, baseY, 18, 0, Math.PI * 2);
    ctx.fill();

    /** @type {number} */
    const stickX = baseX + offsetX * 10;

    /** @type {number} */
    const stickY = baseY + offsetY * 10;

    // Moving Stick
    drawShapeBtn(stickX, stickY, 12, pressed);

    // Light Reflection
    if (!pressed) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.arc(stickX - 3, stickY - 3, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Triggers (LT / RT)
  drawShapeRect(50, 10, 45, 25, [10, 10, 0, 0], visualizerPad.buttons[6].pressed);
  drawShapeRect(205, 10, 45, 25, [10, 10, 0, 0], visualizerPad.buttons[7].pressed);

  // Bumpers (LB / RB)
  drawShapeRect(40, 30, 65, 15, 6, visualizerPad.buttons[4].pressed);
  drawShapeRect(195, 30, 65, 15, 6, visualizerPad.buttons[5].pressed);

  // Main Body
  const bodyGrad = ctx.createLinearGradient(0, 40, 0, 150);
  bodyGrad.addColorStop(0, colors.bodyTop);
  bodyGrad.addColorStop(1, colors.bodyBase);

  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = colors.shadow;
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.roundRect(30, 40, 240, 110, 45);
  ctx.fill();
  resetShadow();

  // Select / Start
  drawShapeRect(130, 75, 14, 8, 4, visualizerPad.buttons[8].pressed);
  drawShapeRect(156, 75, 14, 8, 4, visualizerPad.buttons[9].pressed);

  // ABXY (Top Right)
  /** @type {number} */ const abxyX = 220;
  /** @type {number} */ const abxyY = 75;
  drawShapeBtn(abxyX, abxyY + 19, 9, visualizerPad.buttons[0].pressed); // A
  drawShapeBtn(abxyX + 19, abxyY, 9, visualizerPad.buttons[1].pressed); // B
  drawShapeBtn(abxyX - 19, abxyY, 9, visualizerPad.buttons[2].pressed); // X
  drawShapeBtn(abxyX, abxyY - 19, 9, visualizerPad.buttons[3].pressed); // Y

  // Left Analog Stick (Top Left)
  drawAnalogStick(
    80,
    75,
    visualizerPad.axes[0],
    visualizerPad.axes[1],
    visualizerPad.buttons[10]?.pressed ||
      visualizerPad.axes[0] !== 0 ||
      visualizerPad.axes[1] !== 0,
  );

  // D-Pad Configuration (Bottom Left)
  /** @type {number} */ const dpX = 110;
  /** @type {number} */ const dpY = 115;

  // Up, Down, Left, Right
  drawShapeRect(dpX - 6, dpY - 18, 12, 12, 2, visualizerPad.buttons[12].pressed);
  drawShapeRect(dpX - 6, dpY + 6, 12, 12, 2, visualizerPad.buttons[13].pressed);
  drawShapeRect(dpX - 18, dpY - 6, 12, 12, 2, visualizerPad.buttons[14].pressed);
  drawShapeRect(dpX + 6, dpY - 6, 12, 12, 2, visualizerPad.buttons[15].pressed);

  // D-Pad Center Core
  ctx.fillStyle = colors.btnBase;
  ctx.beginPath();
  ctx.rect(dpX - 6, dpY - 6, 12, 12);
  ctx.fill();

  // Right Analog Stick (Bottom Right)
  drawAnalogStick(
    190,
    115,
    visualizerPad.axes[2],
    visualizerPad.axes[3],
    visualizerPad.buttons[11]?.pressed ||
      visualizerPad.axes[2] !== 0 ||
      visualizerPad.axes[3] !== 0,
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

/**
 * @param {KeyboardEvent} e
 */
const blockKeyboardAction = (e) => {
  if (document.body.classList.contains('is-playing') && virtualPad.connected) {
    e.preventDefault();
  }
};

window.addEventListener('keydown', (e) => {
  if (kbModal.classList.contains('modal-enter') && e.key === 'Escape') {
    if (awaitingBind) {
      awaitingBind = null;
      generateKbUI();
    } else {
      btnCancelKb.click();
    }
    return;
  }

  if (awaitingBind) {
    e.preventDefault();
    currentKeyBinds[awaitingBind] = e.code;
    awaitingBind = null;
    generateKbUI();
    return;
  }

  handleVirtualInput(e.code, true);
  blockKeyboardAction(e);
});

window.addEventListener('keyup', (e) => {
  handleVirtualInput(e.code, false);
  blockKeyboardAction(e);
});

const openKbConfigModal = () => {
  backupKeyBinds = { ...currentKeyBinds };
  renderProfileDropdown();
  renderProfileEditor();
  openModal(kbModal);
  generateKbUI();
  drawGamepadCanvas();
};

btnOpenKbConfig.addEventListener('click', openKbConfigModal);
btnHudKbConfig.addEventListener('click', openKbConfigModal);

btnCloseKb.addEventListener('click', () => {
  closeModal(kbModal);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  localStorage.setItem('pony_kb_binds', JSON.stringify(currentKeyBinds));

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'broadcast_kb_binds',
      binds: currentKeyBinds,
    });
  }
});

/**
 * @returns {void}
 */
const updateHudKbButton = () => {
  btnHudKbConfig.style.display = document.body.classList.contains('is-playing')
    ? 'inline-block'
    : 'none';
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'sync_kb_binds') {
      currentKeyBinds = event.data.binds;

      // Updates the UI live if the user happens to have the modal open in this specific tab
      if (kbModal.classList.contains('modal-enter')) {
        generateKbUI();
      }
    }
  });
}

btnCancelKb.addEventListener('click', () => {
  currentKeyBinds = { ...backupKeyBinds };
  closeModal(kbModal);
  if (animFrameId) cancelAnimationFrame(animFrameId);
});

btnResetKb.addEventListener('click', () => {
  currentKeyBinds = { ...DEFAULT_KEY_BINDS };
  generateKbUI();
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
  /** @type {File} */
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      currentKeyBinds = JSON.parse(evt.target.result);
      generateKbUI();
    } catch (err) {
      showAlert('Invalid JSON format!');
    }
  };
  reader.readAsText(file);
});

useKbPadInput.addEventListener('change', (e) => {
  virtualPad.connected = e.target.checked;
  localStorage.setItem('pony_use_kb', e.target.checked.toString());
  updateHudKbButton();
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
      updateHudKbButton();
      btnOpenTx.style.display = 'block';
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
      currentKeyBinds = { ...DEFAULT_KEY_BINDS, ...currentKeyBinds };
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
      updateHudKbButton();
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
      dbgInput.innerHTML += `<br><span style="color:#f38ba8; font-weight:bold;">${data.message}</span>`;
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
 * @param {Gamepad} gp
 * @returns {{ buttons: {pressed: boolean, value: number}[], axes: number[] }}
 */
const remapGamepad = (gp) => {
  /** @type {string} */
  const id = gp.id.toLowerCase();
  /** @type {GamepadProfile | null} */
  let activeProfile = null;

  /** @type {GamepadProfile[]} */
  const allProfiles = [...Object.values(defaultProfiles), ...Object.values(customProfiles)];

  for (const p of allProfiles) {
    try {
      if (new RegExp(p.regex, 'i').test(id)) {
        activeProfile = p;
        break;
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!activeProfile) {
    return {
      buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
      axes: [...gp.axes],
    };
  }

  /** @type {{pressed: boolean, value: number}[]} */
  const mappedButtons = activeProfile.buttons.map((srcIdx) => {
    /** @type {GamepadButton | undefined} */
    const btn = gp.buttons[srcIdx];
    return btn ? { pressed: btn.pressed, value: btn.value } : { pressed: false, value: 0 };
  });

  /** @type {number[]} */
  const mappedAxes = activeProfile.axes.map((srcIdx) => {
    /** @type {number | undefined} */
    const axis = gp.axes[srcIdx];
    return axis !== undefined ? axis : 0;
  });

  return { buttons: mappedButtons, axes: mappedAxes };
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
      /** @type {{ buttons: {pressed: boolean, value: number}[], axes: number[] }} */
      const mappedData = remapGamepad(gp);

      // Show physical gamepad inputs ONLY on the Profile Tab
      if (!padVisualized && isModalOpen && isProfileTab) {
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

      debugText += `<span style="color:#cba6f7;">Pad [${gp.index}]</span> - Btns Active: ${activeBtnsCount}<br>L: ${lx}, ${ly} | R: ${rx}, ${ry}<br><br>`;
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
      /** @type {number[]} */
      const axesVals = virtualPad.axes;
      /** @type {string} */
      const lx = axesVals[0]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ly = axesVals[1]?.toFixed(2) || '0.00';
      /** @type {string} */
      const rx = axesVals[2]?.toFixed(2) || '0.00';
      /** @type {string} */
      const ry = axesVals[3]?.toFixed(2) || '0.00';

      debugText += `<span style="color:#a6e3a1;">[KB Pad]</span> - Btns Active: ${activeBtnsCount}<br>L: ${lx}, ${ly} | R: ${rx}, ${ry}<br>`;
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
