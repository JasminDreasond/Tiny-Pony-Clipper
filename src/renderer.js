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

electronAPI.onClientListUpdate((event, data) => {
  /** @type {number} */
  const slotsLeft = data.maxGamepads - data.totalGamepads;
  gamepadSlotsInfo.textContent = `Available Gamepad Slots: ${slotsLeft} / ${data.maxGamepads}`;

  if (data.clients.length === 0) {
    clientListContainer.innerHTML =
      '<div style="color: #a6adc8; font-style: italic;">No players connected yet.</div>';
    return;
  }

  clientListContainer.innerHTML = '';
  data.clients.forEach((client, index) => {
    /** @type {HTMLDivElement} */
    const card = document.createElement('div');
    card.style.cssText =
      'background: rgba(30,30,46,0.5); border: 1px solid #45475a; padding: 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;';

    /** @type {string} */
    const dateStr = new Date(client.time).toLocaleTimeString();

    /** @type {string} */
    const pingColor =
      client.latency < 80 ? '#a6e3a1' : client.latency < 150 ? '#fab387' : '#f38ba8';
    /** @type {string} */
    const pingText = client.latency !== undefined ? `${client.latency} ms` : 'Measuring...';

    card.innerHTML = `
      <div>
        <div style="color: #cba6f7; font-weight: bold; margin-bottom: 4px;">Player ${index + 1} (${client.type})</div>
        <div style="font-size: 12px; color: #bac2de;">ID: ${client.id}</div>
        <div style="font-size: 12px; color: #a6e3a1; margin-top: 4px;">🎮 Gamepads Active: ${client.gamepads}</div>
        <div style="font-size: 12px; color: ${pingColor}; margin-top: 2px;">📶 Latency: ${pingText}</div>
        <div style="font-size: 11px; color: #6c7086; margin-top: 4px;">Joined at: ${dateStr}</div>
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

processOfferBtn.addEventListener('click', () => {
  /** @type {string} */
  const b64Offer = clientOfferInput.value.trim();
  clientOfferInput.value = '';

  if (b64Offer) {
    /** @type {string} */
    let offerString = '';

    try {
      offerString = atob(b64Offer);
      // Validação rápida para garantir que o resultado decodificado é um JSON válido
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

electronAPI.onManualAnswer((event, answerString) => {
  clientOfferInput.disabled = false;
  serverAnswerOutput.disabled = false;
  processOfferBtn.disabled = false;

  /** @type {string} */
  const b64Answer = btoa(answerString);
  serverAnswerOutput.value = b64Answer;
  console.log('[UI] Server answer encoded to Base64 and ready to copy.');
});

/**
 * @param {HTMLInputElement} inputElement
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
 * @param {HTMLSelectElement} selectElement
 * @param {Object[]} items
 * @param {string} selectedValue
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
 * @param {KeyboardEvent} event
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
 * @returns {Promise<void>}
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
    uinputWarning.style.display = 'block';
    // Optionally uncheck and disable if you don't want them streaming without gamepad
    // streamEnabledInput.checked = false;
    streamEnabledInput.disabled = true;
  }

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
