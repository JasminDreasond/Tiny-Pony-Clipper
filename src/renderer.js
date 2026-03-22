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
  const config = await window.electronAPI.getConfig();
  /** @type {Object} */
  const hardware = await window.electronAPI.getHardware();

  populateSelect(sysInputSelect, hardware.audioDevices, config.sysInput);
  populateSelect(micInputSelect, hardware.audioDevices, config.micInput);
  document.getElementById('bufferMinutes').value = String(config.minutes);
  document.getElementById('separateAudio').checked = config.separateAudio;
  shortcutInput.value = config.shortcut;
  savePathInput.value = config.savePath;

  shortcutInput.addEventListener('keydown', handleShortcutCapture);
};

document.getElementById('btnBrowse').addEventListener('click', async () => {
  console.log('[RENDERER] Browse button clicked.');
  /** @type {string | null} */
  const folder = await window.electronAPI.selectFolder();
  if (folder) {
    savePathInput.value = folder;
    console.log(`[RENDERER] New save path set in UI: ${folder}`);
  }
});

document.getElementById('btnApply').addEventListener('click', async () => {
  console.log('[RENDERER] Apply button clicked. Gathering configuration...');
  /** @type {Object} */
  const config = {
    minutes: Number(document.getElementById('bufferMinutes').value),
    sysInput: sysInputSelect.value,
    micInput: micInputSelect.value,
    separateAudio: document.getElementById('separateAudio').checked,
    shortcut: shortcutInput.value,
    savePath: savePathInput.value,
  };

  console.log('[RENDERER] Configuration gathered:', config);
  console.log('[RENDERER] Sending configuration to Main process via IPC.');

  /** @type {boolean} */
  const success = await window.electronAPI.saveConfig(config);
  if (success) {
    alert('Settings saved successfully! The recording system is active.');
  } else {
    alert(
      'Validation Error: The selected save directory does not exist or is invalid. Please browse and select a valid folder before applying.',
    );
  }
});

init();
