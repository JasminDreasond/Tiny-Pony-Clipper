import { decompressFromBase64, compressToBase64 } from './public/js/gzipBase64.js';

/** @type {HTMLSelectElement} */
const monitorSelect = document.getElementById('monitorId');

/** @type {HTMLSelectElement} */
const sysInputSelect = document.getElementById('sysInput');

/** @type {HTMLSelectElement} */
const micInputSelect = document.getElementById('micInput');

/** @type {HTMLInputElement} */
const savePathInput = document.getElementById('savePath');

/** @type {HTMLInputElement} */
const shortcutInput = document.getElementById('shortcutKey');

/** @type {HTMLInputElement} */
const videoCodecInput = document.getElementById('videoCodec');

/** @type {HTMLInputElement} */
const audioCodecInput = document.getElementById('audioCodec');

/** @type {HTMLInputElement} */
const videoPresetInput = document.getElementById('videoPreset');

/** @type {HTMLInputElement} */
const videoQualityCmdInput = document.getElementById('videoQualityCmd');

/** @type {HTMLInputElement} */
const videoQualityValueInput = document.getElementById('videoQualityValue');

/** @type {HTMLInputElement} */
const streamEnabledInput = document.getElementById('streamEnabled');

/** @type {HTMLInputElement} */
const streamPortInput = document.getElementById('streamPort');

/** @type {HTMLInputElement} */
const streamPasswordInput = document.getElementById('streamPassword');

/** @type {HTMLDivElement} */
const uinputWarning = document.getElementById('uinputWarning');

/** @type {HTMLSelectElement} */
const gamepadTypeSelect = document.getElementById('gamepadType');

/** @type {HTMLInputElement} */
const enableClippingInput = document.getElementById('enableClipping');

/** @type {HTMLInputElement} */
const maxGamepadsInput = document.getElementById('maxGamepads');

/** @type {HTMLInputElement} */
const iceServersInput = document.getElementById('iceServers');

/** @type {HTMLInputElement} */
const frameRateInput = document.getElementById('frameRate');

/** @type {HTMLInputElement} */
const streamVideoEnabledInput = document.getElementById('streamVideoEnabled');

/** @type {HTMLTextAreaElement} */
const clientOfferInput = document.getElementById('clientOfferInput');

/** @type {HTMLTextAreaElement} */
const serverAnswerOutput = document.getElementById('serverAnswerOutput');

/** @type {HTMLButtonElement} */
const processOfferBtn = document.getElementById('processOfferBtn');

/** @type {HTMLDivElement} */
const manualSdpContainer = document.getElementById('manualSdpContainer');

/** @type {HTMLDivElement} */
const clientListContainer = document.getElementById('clientList');
/** @type {HTMLDivElement} */
const gamepadSlotsInfo = document.getElementById('gamepadSlotsInfo');

/** @type {HTMLDivElement} */
const authListContainer = document.getElementById('authListContainer');

/**
 * Renders the firewall/permissions list dynamically based on saved configurations.
 *
 * @returns {Promise<void>}
 */
const renderAuthList = async () => {
  if (!authListContainer) return;

  /** @type {Object} */
  const authList = await electronAPI.getAuthList();
  authListContainer.innerHTML = '';

  /** @type {string[]} */
  const keys = Object.keys(authList);

  if (keys.length === 0) {
    authListContainer.innerHTML =
      '<div class="muted-text" style="font-style: italic;">No applications have requested permissions yet.</div>';
    return;
  }

  keys.forEach((callerPath) => {
    /** @type {boolean} */
    const isAllowed = authList[callerPath];

    /** @type {HTMLDivElement} */
    const card = document.createElement('div');
    card.style.cssText =
      'border: 1px solid; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 10px;';

    card.innerHTML = `
      <div class="muted-text" style="font-family: monospace; font-size: 12px; word-break: break-all;">${callerPath}</div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="status-item ${isAllowed ? 'latency-1' : 'latency-3'}">
          Status: ${isAllowed ? 'Allowed' : 'Denied'}
        </span>
        <div style="display: flex; gap: 10px;">
          <button class="toggle-auth-btn" data-caller="${callerPath}" data-allowed="${isAllowed}" style="width: auto; padding: 6px 12px; background: ${isAllowed ? '#f38ba8' : '#a6e3a1'}; color: #11111b; font-size: 12px;">
            ${isAllowed ? 'Block' : 'Allow'}
          </button>
          <button class="delete-auth-btn" data-caller="${callerPath}" style="width: auto; padding: 6px 12px; background: #45475a; color: #cdd6f4; font-size: 12px;">Remove</button>
        </div>
      </div>
    `;
    authListContainer.appendChild(card);
  });

  document.querySelectorAll('.toggle-auth-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      /** @type {string} */
      const caller = e.target.getAttribute('data-caller');
      /** @type {boolean} */
      const currentlyAllowed = e.target.getAttribute('data-allowed') === 'true';
      await electronAPI.updateAuth(caller, !currentlyAllowed);
      renderAuthList();
    });
  });

  document.querySelectorAll('.delete-auth-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      /** @type {string} */
      const caller = e.target.getAttribute('data-caller');
      if (confirm('Remove this application from the firewall list?')) {
        await electronAPI.deleteAuth(caller);
        renderAuthList();
      }
    });
  });
};

// Also add a listener so the list updates when the tab is clicked
document.querySelector('[data-target="tab-permissions"]').addEventListener('click', renderAuthList);

// Inside your init() function, add:
renderAuthList();

/**
 * Updates the user interface state for the streaming section based on whether the stream is enabled.
 * Toggles the disabled state of manual SDP inputs and updates the connected players status message.
 *
 * @returns {void}
 */
const updateStreamUIState = () => {
  /** @type {boolean} */
  const isEnabled = streamEnabledInput.checked;

  processOfferBtn.disabled = !isEnabled;
  clientOfferInput.disabled = !isEnabled;
  serverAnswerOutput.disabled = !isEnabled;

  if (!isEnabled) {
    clientListContainer.innerHTML =
      '<div style="color: #f38ba8; font-style: italic;">Remote Play is disabled. Enable it to connect players.</div>';
    gamepadSlotsInfo.textContent = 'Available Gamepad Slots: Remote Play Disabled';
  } else {
    clientListContainer.innerHTML =
      '<div class="muted-text" style="font-style: italic;">No players connected yet.</div>';
    gamepadSlotsInfo.textContent = 'Available Gamepad Slots: Waiting for server...';
  }
};

streamEnabledInput.addEventListener('change', updateStreamUIState);

electronAPI.onClientListUpdate((event, data) => {
  /** @type {number} */
  const slotsLeft = data.maxGamepads - data.totalGamepads;
  gamepadSlotsInfo.textContent = `Available Gamepad Slots: ${slotsLeft} / ${data.maxGamepads}`;

  if (data.clients.length === 0) {
    clientListContainer.innerHTML =
      '<div class="muted-text" style="font-style: italic;">No players connected yet.</div>';
    return;
  }

  clientListContainer.innerHTML = '';
  data.clients.forEach((client, index) => {
    /** @type {HTMLDivElement} */
    const card = document.createElement('div');
    card.style.cssText =
      'border: 1px solid #45475a; padding: 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;';

    /** @type {string} */
    const dateStr = new Date(client.time).toLocaleTimeString();

    /** @type {string} */
    const pingColor =
      client.latency < 80 ? 'latency-1' : client.latency < 150 ? 'latency-2' : 'latency-3';
    /** @type {string} */
    const pingText = client.latency !== undefined ? `${client.latency} ms` : 'Measuring...';

    card.innerHTML = `
      <div>
        <div class="user-index">Player ${index + 1} (${client.type})</div>
        <div class="user-id">ID: ${client.id}</div>
        <div class="user-gamepads">🎮 Gamepads Active: ${client.gamepads}</div>
        <div class="user-ping ${pingColor}">📶 Latency: ${pingText}</div>
        <div class="user-join">Joined at: ${dateStr}</div>
      </div>
      <button class="kick-btn" data-id="${client.id}" style="width: auto; background: #f38ba8; color: #11111b; padding: 8px 16px;">Kick</button>
    `;

    clientListContainer.appendChild(card);
  });

  document.querySelectorAll('.kick-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      /** @type {string | null} */
      const idToKick = e.target.getAttribute('data-id');
      if (idToKick && confirm(`Are you sure you want to kick ${idToKick}?`)) {
        electronAPI.kickClient(idToKick);
      }
    });
  });
});

/** @type {NodeListOf<HTMLButtonElement>} */
const tabBtns = document.querySelectorAll('.tab-btn');
/** @type {NodeListOf<HTMLDivElement>} */
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabContents.forEach((c) => c.classList.remove('active'));

    btn.classList.add('active');
    /** @type {string | null} */
    const targetId = btn.getAttribute('data-target');
    if (targetId) {
      /** @type {HTMLElement | null} */
      const targetElement = document.getElementById(targetId);
      if (targetElement) targetElement.classList.add('active');
    }
  });
});

clientOfferInput.addEventListener('input', () => {
  serverAnswerOutput.value = '';
});

processOfferBtn.addEventListener('click', async () => {
  /** @type {string} */
  const b64Offer = clientOfferInput.value.trim();
  clientOfferInput.value = '';

  if (b64Offer) {
    /** @type {string} */
    let offerString = '';

    try {
      offerString = await decompressFromBase64(b64Offer);
      // Quick validation to ensure the decoded result is a valid JSON
      JSON.parse(offerString);
    } catch (e) {
      alert('Invalid Base64 format! Please ensure you copied the entire code correctly.');
      return;
    }

    clientOfferInput.disabled = true;
    serverAnswerOutput.disabled = true;
    processOfferBtn.disabled = true;
    serverAnswerOutput.value = 'Processing... Please wait for ICE gathering.';
    electronAPI.sendManualOffer(offerString);
  }
});

electronAPI.onManualAnswer(async (event, answerString) => {
  clientOfferInput.disabled = false;
  serverAnswerOutput.disabled = false;
  processOfferBtn.disabled = false;

  /** @type {string} */
  const b64Answer = await compressToBase64(answerString);
  serverAnswerOutput.value = b64Answer;
  console.log('[UI] Server answer encoded to Base64 and ready to copy.');
});

/**
 * Enforces minimum and maximum numerical limits on an HTML input element.
 * Listens to the 'change' event and corrects out-of-bounds values.
 *
 * @param {HTMLInputElement} inputElement - The input element to apply validation to.
 * @returns {void}
 */
const enforceNumberValidation = (inputElement) => {
  if (!inputElement) return;

  inputElement.addEventListener('change', () => {
    /** @type {number} */
    const min = parseInt(inputElement.getAttribute('min') || '-999999', 10);
    /** @type {number} */
    const max = parseInt(inputElement.getAttribute('max') || '999999', 10);
    /** @type {number} */
    let val = parseInt(inputElement.value, 10);

    if (isNaN(val)) val = min > 0 ? min : 0;
    if (val < min) val = min;
    if (val > max) val = max;

    inputElement.value = String(val);
  });
};

/** @type {boolean} */
let isWaylandEnvironment = false;

/**
 * Populates an HTML select element with options generated from an array of objects.
 * Clears existing options before appending new ones and sets the selected value.
 *
 * @param {HTMLSelectElement} selectElement - The select dropdown element to populate.
 * @param {Object[]} items - An array of objects containing 'id' and 'name' properties.
 * @param {string} selectedValue - The value to be set as selected after population.
 * @returns {void}
 */
const populateSelect = (selectElement, items, selectedValue) => {
  selectElement.innerHTML = '';
  for (const item of items) {
    /** @type {HTMLOptionElement} */
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    selectElement.appendChild(option);
  }
  selectElement.value = selectedValue;
};

/**
 * Handles the keyboard event to capture a combination of modifier keys and a main key.
 * Formats the combination and updates the shortcut input field value.
 *
 * @param {KeyboardEvent} event - The keyboard event triggered by the user input.
 * @returns {void}
 */
const handleShortcutCapture = (event) => {
  event.preventDefault();
  /** @type {string[]} */
  const keys = [];
  if (event.ctrlKey) keys.push('CommandOrControl');
  if (event.altKey) keys.push('Alt');
  if (event.shiftKey) keys.push('Shift');
  if (event.metaKey) keys.push('Super');

  /** @type {string} */
  const key = event.key;
  /** @type {string[]} */
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];

  if (!modifiers.includes(key)) {
    keys.push(key.length === 1 ? key.toUpperCase() : key);
    shortcutInput.value = keys.join('+');
  }
};

/**
 * Initializes the application state by fetching configuration and hardware details from the main process.
 * Applies the fetched data to the UI components and sets up environment-specific behaviors like Wayland shortcuts.
 *
 * @returns {Promise<void>} Resolves when the initialization is complete.
 */
const init = async () => {
  console.log('[RENDERER] Loading saved configuration...');

  /** @type {Object} */
  const config = await electronAPI.getConfig();
  /** @type {Object} */
  const hardware = await electronAPI.getHardware();

  isWaylandEnvironment = await electronAPI.isWayland();

  populateSelect(sysInputSelect, hardware.audioOutputs, config.sysInput);
  populateSelect(micInputSelect, hardware.audioInputs, config.micInput);
  document.getElementById('bufferMinutes').value = String(config.minutes);
  document.getElementById('separateAudio').checked = config.separateAudio;
  savePathInput.value = config.savePath;

  videoCodecInput.value = config.videoCodec ?? 'h264_nvenc';
  audioCodecInput.value = config.audioCodec ?? 'aac';
  videoPresetInput.value = config.videoPreset ?? 'p6';
  videoQualityCmdInput.value = config.videoQualityCmd ?? '-cq';
  videoQualityValueInput.value = config.videoQualityValue ?? '19';
  enableClippingInput.checked = config.enableClipping ?? true;
  maxGamepadsInput.value = config.maxGamepads ?? 12;
  iceServersInput.value = config.iceServers ?? 'stun:stun.l.google.com:19302';
  frameRateInput.value = String(config.frameRate ?? 60);
  streamVideoEnabledInput.checked = config.streamVideoEnabled ?? true;

  if (isWaylandEnvironment) {
    console.log('[RENDERER] Wayland detected. Forcing F10 shortcut and hiding input.');
    shortcutInput.value = 'F10';
    shortcutInput.disabled = true;
    shortcutInput.style.display = 'none';

    if (shortcutInput.parentElement) {
      shortcutInput.parentElement.style.display = 'none';
    }
  } else {
    shortcutInput.value = config.shortcut;
    shortcutInput.addEventListener('keydown', handleShortcutCapture);
  }

  // Load stream config
  streamEnabledInput.checked = config.streamEnabled ?? false;
  streamPortInput.value = config.streamPort ?? 8080;
  streamPasswordInput.value = config.streamPassword ?? 'pony';
  gamepadTypeSelect.value = config.gamepadType ?? 'xbox';

  // Check gamepad permissions
  /** @type {boolean} */
  const isGamepadReady = await electronAPI.getGamepadStatus();
  if (!isGamepadReady) {
    uinputWarning.innerHTML =
      electronAPI.platform() !== 'win32'
        ? `⚠️ Missing permissions for Virtual Gamepad! The app cannot inject controller inputs.
      Please configure uinput permissions on your Linux system.`
        : `⚠️ It looks like the ViGEmBus driver is missing from your system.
      This driver is required to emulate Xbox and PlayStation controllers on Windows.
      Please install the latest ViGEmBus driver and restart the application.`;
    uinputWarning.style.display = 'block';
    // Optionally uncheck and disable if you don't want them streaming without gamepad
    // streamEnabledInput.checked = false;
    streamEnabledInput.disabled = true;
  }

  updateStreamUIState();

  document.querySelectorAll('input[type="number"]').forEach(enforceNumberValidation);
};

document.getElementById('btnBrowse').addEventListener('click', async () => {
  console.log('[RENDERER] Browse button clicked.');
  /** @type {string | null} */
  const folder = await electronAPI.selectFolder();
  if (folder) {
    savePathInput.value = folder;
    console.log(`[RENDERER] New save path set in UI: ${folder}`);
  }
});

document.getElementById('btnApply').addEventListener('click', async () => {
  console.log('[RENDERER] Apply button clicked. Gathering configuration...');

  /** @type {string} */
  const finalShortcut = isWaylandEnvironment ? 'F10' : shortcutInput.value;

  /** @type {Object} */
  const config = {
    enableClipping: enableClippingInput.checked,
    minutes: Number(document.getElementById('bufferMinutes').value),
    sysInput: sysInputSelect.value ?? 'default',
    micInput: micInputSelect.value ?? 'none',
    separateAudio: document.getElementById('separateAudio').checked ?? false,
    shortcut: finalShortcut ?? 'F10',
    savePath: savePathInput.value,
    videoCodec: videoCodecInput.value || 'h264_nvenc',
    audioCodec: audioCodecInput.value || 'aac',
    videoPreset: videoPresetInput.value || 'p6',
    videoQualityCmd: videoQualityCmdInput.value || '-cq',
    videoQualityValue: videoQualityValueInput.value || '19',
    frameRate: Number(frameRateInput.value) > 0 ? Number(frameRateInput.value) : 60,
    streamVideoEnabled: streamVideoEnabledInput.checked,
    // Stream values
    streamEnabled: streamEnabledInput.checked,
    streamPort: Number(streamPortInput.value) || 8080,
    streamPassword: streamPasswordInput.value || 'pony',
    gamepadType: gamepadTypeSelect.value || 'xbox',
    maxGamepads: Number(maxGamepadsInput.value) >= 0 ? Number(maxGamepadsInput.value) : 12,
    iceServers: iceServersInput.value.trim() || 'stun:stun.l.google.com:19302',
  };

  console.log('[RENDERER] Configuration gathered:', config);
  console.log('[RENDERER] Sending configuration to Main process via IPC.');

  /** @type {boolean} */
  const success = await electronAPI.saveConfig(config);
  if (success) {
    alert('Settings saved successfully! The recording system is active.');
  } else {
    alert(
      'Validation Error: The selected save directory does not exist or is invalid. Please browse and select a valid folder before applying.',
    );
  }
});

document.getElementById('btnGithub').addEventListener('click', () => {
  console.log('[RENDERER] Opening GitHub repository...');
  electronAPI.openExternal('https://github.com/Pony-House/Tiny-Pony-Clipper');
});

init();
