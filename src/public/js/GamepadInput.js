import {
  // Keyboard Gamepad UI
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

  // Manual SDP Elements
  btnHudKbConfig,

  // Tab Configuration Elements
  tabKbBtn,
  tabProfileBtn,
  tabKbContent,
  tabProfileContent,
  tabFilterBtn,
  tabFilterContent,
  filterRegexInput,
  filterGrid,

  // Profile Manager Elements
  profileSelect,
  btnCreateProfile,
  btnCloneProfile,
  btnDeleteProfile,
  profileName,
  profileRegex,
  profileEmulateTriggers,
  profileButtonsGrid,
  profileAxesGrid,
  btnExportProfile,
  btnImportProfileBtn,
  btnImportProfileFile,
  btnSaveProfile,
} from './html.js';
import { showAlert, openModal, closeModal } from './Modal.js';

// --- GAMEPAD PROFILES MANAGER LOGIC ---

/**
 * @typedef {Object} GamepadProfile
 * @property {string} name
 * @property {string} regex
 * @property {number[]} buttons
 * @property {number[]} axes
 * @property {boolean} [readonly]
 * @property {boolean} [emulateTriggers]
 */

/** @type {Record<string, GamepadProfile>} */
const defaultProfiles = {};

/** @type {GamepadProfile | null} */
let liveEditingBuffer = null;

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
 * Persistence logic to commit buffer changes to localStorage.
 * @returns {void}
 */
const commitProfileBuffer = () => {
  if (!liveEditingBuffer) return;

  /** @type {string} */
  const currentVal = profileSelect.value;
  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(currentVal);

  if (parsed.type === 'custom') {
    customProfiles[parsed.key] = { ...liveEditingBuffer };
    saveCustomProfiles();
    renderProfileDropdown();
    profileSelect.value = currentVal;
    showAlert('Profile saved successfully!');
  }
};

/**
 * @returns {void}
 */
const disableAllEditorFields = () => {
  profileName.value = '';
  profileRegex.value = '';
  profileName.disabled = true;
  profileRegex.disabled = true;
  profileEmulateTriggers.checked = false;
  profileEmulateTriggers.disabled = true;

  btnSaveProfile.disabled = true;
  btnDeleteProfile.disabled = true;
  btnCloneProfile.disabled = true;
  btnExportProfile.disabled = true;

  profileButtonsGrid.innerHTML = '';
  profileAxesGrid.innerHTML = '';
};

/** @type {Record<number, { name: string, icon: string }>} */
const profileButtonMap = {
  0: { name: 'A', icon: 'img/kenney_input_xbox_series/xbox_button_a.png' },
  1: { name: 'B', icon: 'img/kenney_input_xbox_series/xbox_button_b.png' },
  2: { name: 'X', icon: 'img/kenney_input_xbox_series/xbox_button_x.png' },
  3: { name: 'Y', icon: 'img/kenney_input_xbox_series/xbox_button_y.png' },
  4: { name: 'LB', icon: 'img/kenney_input_xbox_series/xbox_lb.png' },
  5: { name: 'RB', icon: 'img/kenney_input_xbox_series/xbox_rb.png' },
  6: { name: 'LT', icon: 'img/kenney_input_xbox_series/xbox_lt.png' },
  7: { name: 'RT', icon: 'img/kenney_input_xbox_series/xbox_rt.png' },
  8: { name: 'Select', icon: 'img/kenney_input_xbox_series/xbox_button_back.png' },
  9: { name: 'Start', icon: 'img/kenney_input_xbox_series/xbox_button_start.png' },
  10: { name: 'LS', icon: 'img/kenney_input_xbox_series/xbox_ls.png' },
  11: { name: 'RS', icon: 'img/kenney_input_xbox_series/xbox_rs.png' },
  12: { name: 'Up', icon: 'img/kenney_input_xbox_series/xbox_dpad_up.png' },
  13: { name: 'Down', icon: 'img/kenney_input_xbox_series/xbox_dpad_down.png' },
  14: { name: 'Left', icon: 'img/kenney_input_xbox_series/xbox_dpad_left.png' },
  15: { name: 'Right', icon: 'img/kenney_input_xbox_series/xbox_dpad_right.png' },
  16: { name: 'Home', icon: 'img/kenney_input_xbox_series/xbox_guide.png' },
};

/** @type {Record<number, { name: string, icon: string }>} */
const profileAxesMap = {
  0: { name: 'LS X', icon: 'img/kenney_input_xbox_series/xbox_stick_l_left.png' },
  1: { name: 'LS Y', icon: 'img/kenney_input_xbox_series/xbox_stick_l_up.png' },
  2: { name: 'RS X', icon: 'img/kenney_input_xbox_series/xbox_stick_r_left.png' },
  3: { name: 'RS Y', icon: 'img/kenney_input_xbox_series/xbox_stick_r_up.png' },
  4: { name: 'LT Axis', icon: 'img/kenney_input_xbox_series/xbox_lt.png' },
  5: { name: 'RT Axis', icon: 'img/kenney_input_xbox_series/xbox_rt.png' },
};

/**
 * Creates a visual input box for the profile editor grid using CSS variables.
 *
 * @param {number} index
 * @param {number} value
 * @param {boolean} isReadonly
 * @param {{name: string, icon: string} | undefined} info
 * @param {[number, number]} limits
 * @param {'buttons' | 'axes'} type
 * @returns {HTMLElement}
 */
const createProfileInputItem = (index, value, isReadonly, info, limits, type) => {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.alignItems = 'center';
  wrapper.style.background = 'var(--bg-mantle)';
  wrapper.style.padding = '4px';
  wrapper.style.borderRadius = '4px';
  wrapper.style.border = '1px solid var(--bg-surface0)';

  /** @type {string} */
  const iconHtml =
    info && info.icon
      ? `<img src="${info.icon}" alt="${info.name}" title="${info.name}" style="height: 20px; margin-bottom: 4px;" />`
      : `<span style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; font-weight: bold;">${info ? info.name : `IDX ${index}`}</span>`;

  wrapper.innerHTML = `${iconHtml}<input type="number" min="${limits[0]}" max="${limits[1]}" style="width: 100%; text-align: center; box-sizing: border-box;" />`;

  /** @type {HTMLInputElement | null} */
  const input = wrapper.querySelector('input');
  if (input) {
    input.value = value.toString();
    input.disabled = isReadonly;
    input.oninput = (e) => {
      if (liveEditingBuffer) {
        liveEditingBuffer[type][index] = parseInt(e.target.value, 10) || 0;
      }
    };
  }

  return wrapper;
};

/**
 * @returns {void}
 */
const renderProfileEditor = () => {
  /** @type {string} */
  const currentVal = profileSelect.value;

  if (!currentVal) {
    disableAllEditorFields();
    liveEditingBuffer = null;
    return;
  }

  /** @type {{ type: 'default' | 'custom', key: string }} */
  const parsed = parseProfileVal(currentVal);

  /** @type {GamepadProfile | null | undefined} */
  const profile =
    parsed.type === 'default' ? defaultProfiles[parsed.key] : customProfiles[parsed.key];

  if (!profile) {
    disableAllEditorFields();
    liveEditingBuffer = null;
    return;
  }

  // Initialize live buffer with a deep copy of the selected profile
  liveEditingBuffer = {
    name: profile.name,
    regex: profile.regex,
    buttons: [...profile.buttons],
    axes: [...profile.axes],
    readonly: profile.readonly,
    emulateTriggers: !!profile.emulateTriggers,
  };

  /** @type {boolean} */
  const isReadonly = !!profile.readonly;

  profileName.value = profile.name;
  profileRegex.value = profile.regex;
  profileEmulateTriggers.checked = liveEditingBuffer.emulateTriggers;

  profileName.disabled = isReadonly;
  profileRegex.disabled = isReadonly;
  profileEmulateTriggers.disabled = isReadonly;

  btnSaveProfile.disabled = isReadonly;
  btnDeleteProfile.disabled = isReadonly;

  // These can always be used if a valid profile exists
  btnCloneProfile.disabled = false;
  btnExportProfile.disabled = false;

  // Sync buffer on metadata change
  const syncMetadata = () => {
    if (liveEditingBuffer) {
      liveEditingBuffer.name = profileName.value;
      liveEditingBuffer.regex = profileRegex.value;
      liveEditingBuffer.emulateTriggers = profileEmulateTriggers.checked;
    }
  };
  profileName.oninput = syncMetadata;
  profileRegex.oninput = syncMetadata;
  profileEmulateTriggers.onchange = syncMetadata;

  // Clear and render the Buttons grid using icons
  profileButtonsGrid.innerHTML = '';
  for (let i = 0; i <= 16; i++) {
    /** @type {number} */
    const btnValue = profile.buttons[i] !== undefined ? profile.buttons[i] : i;
    const inputItem = createProfileInputItem(
      i,
      btnValue,
      isReadonly,
      profileButtonMap[i],
      [0, 32],
      'buttons',
    );
    profileButtonsGrid.appendChild(inputItem);
  }

  // Clear and render the Axes grid using icons
  profileAxesGrid.innerHTML = '';
  for (let i = 0; i <= 5; i++) {
    /** @type {number} */
    const axisValue = profile.axes[i] !== undefined ? profile.axes[i] : i;
    const inputItem = createProfileInputItem(
      i,
      axisValue,
      isReadonly,
      profileAxesMap[i],
      [0, 8],
      'axes',
    );
    profileAxesGrid.appendChild(inputItem);
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
    axes: [0, 1, 2, 3, 4, 5], // Axis in original order
    emulateTriggers: false,
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
    emulateTriggers: !!srcProfile.emulateTriggers,
  };

  saveCustomProfiles();
  renderProfileDropdown();
  profileSelect.value = `custom_${newKey}`;
  renderProfileEditor();
});

btnSaveProfile.addEventListener('click', commitProfileBuffer);

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
      /** @type {string | null} */
      let firstImportedKey = null;

      Object.keys(importedData).forEach((k) => {
        /** @type {GamepadProfile} */
        const p = importedData[k];
        if (p && p.name && p.buttons && p.axes) {
          p.readonly = false; // Always force imports to be editable
          customProfiles[k] = p;
          if (!firstImportedKey) firstImportedKey = k;
        }
      });

      saveCustomProfiles();
      renderProfileDropdown();

      // Auto-select the first imported profile to immediately show it to the user
      if (firstImportedKey) {
        profileSelect.value = `custom_${firstImportedKey}`;
      }

      // Re-renders and reactivates the editor fields
      renderProfileEditor();

      showAlert('Profile(s) imported successfully!');
    } catch (err) {
      showAlert('Invalid JSON profile format!');
    }

    // Clear the input so the same file can be imported again if needed
    btnImportProfileFile.value = '';
  };

  reader.readAsText(file);
});

// --- MODAL TAB LOGIC ---

/**
 * @param {HTMLElement} btn
 * @param {HTMLElement} content
 * @returns {void}
 */
const switchTab = (btn, content) => {
  tabKbBtn.classList.remove('active');
  tabProfileBtn.classList.remove('active');
  tabFilterBtn.classList.remove('active');

  tabKbContent.classList.remove('active');
  tabProfileContent.classList.remove('active');
  tabFilterContent.classList.remove('active');

  btn.classList.add('active');
  content.classList.add('active');

  if (content === tabFilterContent) {
    renderFilterList();
  }
};

tabKbBtn.addEventListener('click', () => switchTab(tabKbBtn, tabKbContent));
tabProfileBtn.addEventListener('click', () => switchTab(tabProfileBtn, tabProfileContent));
tabFilterBtn.addEventListener('click', () => switchTab(tabFilterBtn, tabFilterContent));

// --- KEYBOARD EMULATOR LOGIC ---

/**
 * @typedef {Object} VisualizerPadState
 * @property {number[]} axes
 * @property {{pressed: boolean, value: number}[]} buttons
 */

/** @type {VisualizerPadState} */
export const visualizerPad = {
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
export const virtualPad = {
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

  // Home
  btnHome: {
    icon: 'img/kenney_input_xbox_series/xbox_guide.png',
    name: 'Home',
    type: 'button',
    index: 16,
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
  btnHome: 'Backspace',
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

// Dynamic Canvas Colors Holder
export let parsedColors = {};

/**
 * Extracts CSS variables to paint the canvas dynamically according to the active theme.
 * @returns {void}
 */
export const updateCanvasColors = () => {
  const rs = getComputedStyle(document.documentElement);
  parsedColors = {
    bodyBase: rs.getPropertyValue('--bg-base').trim() || '#1e1e2e',
    bodyTop: rs.getPropertyValue('--bg-surface0').trim() || '#313244',
    btnBase: rs.getPropertyValue('--bg-surface1').trim() || '#45475a',
    btnPressed: rs.getPropertyValue('--accent-mauve').trim() || '#cba6f7',
    shadow: rs.getPropertyValue('--shadow-medium').trim() || 'rgba(0, 0, 0, 0.4)',
    bgBase: rs.getPropertyValue('--bg-mantle').trim() || '#181825',
  };
};

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
   * Reusable style functions
   * @param {boolean} pressed
   * @returns {void}
   */
  const applyGlowOrShadow = (pressed) => {
    // If pressed, use the accent color to glow. If not, use the theme shadow.
    ctx.shadowColor = pressed ? parsedColors.btnPressed : parsedColors.shadow;
    ctx.shadowBlur = pressed ? 12 : 5;
    ctx.shadowOffsetY = pressed ? 0 : 3;
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
    ctx.fillStyle = pressed ? parsedColors.btnPressed : parsedColors.btnBase;
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
    ctx.fillStyle = pressed ? parsedColors.btnPressed : parsedColors.btnBase;
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
    ctx.fillStyle = parsedColors.bgBase;
    ctx.beginPath();
    ctx.arc(baseX, baseY, 18, 0, Math.PI * 2);
    ctx.fill();

    /** @type {number} */
    const stickX = baseX + offsetX * 10;

    /** @type {number} */
    const stickY = baseY + offsetY * 10;

    /** @type {number} */
    const radius = pressed ? 10 : 12; // Decreases the radius by pressing to give depth sensation

    // Moving Stick
    drawShapeBtn(stickX, stickY, radius, pressed);

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
  bodyGrad.addColorStop(0, parsedColors.bodyTop);
  bodyGrad.addColorStop(1, parsedColors.bodyBase);

  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = parsedColors.shadow;
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  ctx.roundRect(30, 40, 240, 110, 45);
  ctx.fill();
  resetShadow();

  // Select / Start / Home
  drawShapeRect(130, 75, 14, 8, 4, visualizerPad.buttons[8].pressed);
  drawShapeRect(156, 75, 14, 8, 4, visualizerPad.buttons[9].pressed);
  drawShapeBtn(150, 55, 8, visualizerPad.buttons[16].pressed);

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
    visualizerPad.buttons[10].pressed,
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
  ctx.fillStyle = parsedColors.btnBase;
  ctx.beginPath();
  ctx.rect(dpX - 6, dpY - 6, 12, 12);
  ctx.fill();

  // Right Analog Stick (Bottom Right)
  drawAnalogStick(
    190,
    115,
    visualizerPad.axes[2],
    visualizerPad.axes[3],
    visualizerPad.buttons[11].pressed,
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
      if (!config) return;
      if (config.type === 'button') {
        virtualPad.buttons[config.index].pressed = true;
        virtualPad.buttons[config.index].value = 1;
      } else if (config.type === 'axis') {
        virtualPad.axes[config.index] += config.val;
      }
    });
  }

  // Clamping axis values to -1.0 / 1.0 range
  for (let i = 0; i < 4; i++) {
    virtualPad.axes[i] = Math.max(-1, Math.min(1, virtualPad.axes[i]));
  }
};

/**
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
const isTyping = (e) => {
  /** @type {HTMLElement} */
  const target = /** @type {any} */ (e.target);
  if (!target) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
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

  // Prevents the emulator from "stealing" the keys and triggering controls while you type
  if (isTyping(e)) return;

  handleVirtualInput(e.code, true);
  blockKeyboardAction(e);
});

window.addEventListener('keyup', (e) => {
  // Always releases the key in the virtual array, avoiding stuck keys if the focus changes in the middle of the click
  handleVirtualInput(e.code, false);
  if (isTyping(e)) return;
  blockKeyboardAction(e);
});

const openKbConfigModal = () => {
  backupKeyBinds = { ...currentKeyBinds };
  renderProfileDropdown();
  renderProfileEditor();
  openModal(kbModal);
  generateKbUI();
  updateCanvasColors(); // Ensure colors are fresh before opening
  drawGamepadCanvas();
};

btnOpenKbConfig.addEventListener('click', openKbConfigModal);
btnHudKbConfig.addEventListener('click', openKbConfigModal);

btnCloseKb.addEventListener('click', () => {
  // If we are on the profiles tab, commit changes
  if (tabProfileContent.classList.contains('active')) {
    commitProfileBuffer();
  }

  closeModal(kbModal);
  liveEditingBuffer = null; // Clear buffer
  if (animFrameId) cancelAnimationFrame(animFrameId);
  // Existing keyboard save logic...
  localStorage.setItem('pony_kb_binds', JSON.stringify(currentKeyBinds));

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'broadcast_kb_binds',
      binds: currentKeyBinds,
    });
  }
});

btnCancelKb.addEventListener('click', () => {
  currentKeyBinds = { ...backupKeyBinds };
  liveEditingBuffer = null; // Revert by simply nulling the buffer
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

// --- POPUP TRANSMITTER ---

btnOpenTx.addEventListener('click', () => {
  const popupHtml = `<!DOCTYPE html><html><head><title>Input Transmitter</title><style>body{background:var(--bg-base,#1e1e2e);color:var(--accent-mauve,#cba6f7);font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;}h3{margin:0;}</style></head><body><div><h3>Transmitter Active</h3><p>Keep this window focused to send keyboard and gamepad inputs to Tiny Pony Stream.</p></div><script>['keydown','keyup'].forEach(evt=>{window.addEventListener(evt,e=>{e.preventDefault();if(window.opener){window.opener.postMessage({type:'kb_event',event:evt,code:e.code},'*');}});});</script></body></html>`;
  const blob = new Blob([popupHtml], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), 'InputTransmitter', 'width=350,height=250');
});

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'kb_event') {
    handleVirtualInput(e.data.code, e.data.event === 'keydown');
  }
});

// --- GAMEPAD FILTER LOGIC ---

/** @type {Set<string>} */
const blockedGamepads = new Set(JSON.parse(localStorage.getItem('pony_blocked_pads') || '[]'));

/**
 * @returns {void}
 */
const saveBlockedGamepads = () => {
  localStorage.setItem('pony_blocked_pads', JSON.stringify([...blockedGamepads]));
};

// Loads the saved regex or uses the default '.*' (allow all)
filterRegexInput.value = localStorage.getItem('pony_filter_regex') || '.*';

filterRegexInput.addEventListener('input', (e) => {
  localStorage.setItem('pony_filter_regex', e.target.value);
});

/**
 * @returns {void}
 */
const renderFilterList = () => {
  filterGrid.innerHTML = '';
  /** @type {Gamepad[]} */
  const gps = navigator.getGamepads();
  /** @type {boolean} */
  let hasPads = false;

  for (let i = 0; i < gps.length; i++) {
    /** @type {Gamepad | null} */
    const gp = gps[i];
    if (gp && gp.connected) {
      hasPads = true;
      const label = document.createElement('label');
      label.className = 'checkbox-container';
      label.style.background = 'var(--bg-mantle)';
      label.style.padding = '8px';
      label.style.borderRadius = '6px';
      label.style.border = '1px solid var(--bg-surface0)';
      label.style.cursor = 'pointer';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = blockedGamepads.has(gp.id);
      cb.onchange = (e) => {
        if (e.target.checked) {
          blockedGamepads.add(gp.id);
        } else {
          blockedGamepads.delete(gp.id);
        }
        saveBlockedGamepads();
      };

      const span = document.createElement('span');
      // The regex does not affect the visual listing of the buttons, it just says if it has final permission,
      // to the user to always see what is physically connected.
      span.textContent = `[Idx: ${gp.index}] ${gp.id}`;

      label.appendChild(cb);
      label.appendChild(span);
      filterGrid.appendChild(label);
    }
  }

  if (!hasPads) {
    filterGrid.innerHTML =
      '<span style="font-size: 13px; color: var(--text-sub);">No gamepads connected. Plug one in!</span>';
  }
};

// Keeps the list up to date if a control is connected/disconnected while the modal is open
window.addEventListener('gamepadconnected', () => {
  if (tabFilterContent.classList.contains('active')) renderFilterList();
});
window.addEventListener('gamepaddisconnected', () => {
  if (tabFilterContent.classList.contains('active')) renderFilterList();
});

/**
 * Validate whether the gamepad is allowed to be broadcast based on regex and checkboxes.
 * The sequence: 1. Valida Regex (Whitelist) -> 2. Validate Checkbox (Blacklist).
 * @param {Gamepad} gp
 * @returns {boolean}
 */
export const isGamepadAllowed = (gp) => {
  // 1. Regex Validation
  /** @type {string} */
  const regexStr = filterRegexInput.value || '.*';
  try {
    /** @type {RegExp} */
    const regex = new RegExp(regexStr, 'i');
    if (!regex.test(gp.id)) return false;
  } catch (e) {
    // If the user types a broken regex into the field, it doesn't block everything, let it pass.
    console.warn('[INPUT FILTER] Invalid regex pattern:', regexStr);
  }

  // 2. Checkbox Validation
  if (blockedGamepads.has(gp.id)) {
    return false;
  }

  return true;
};

/**
 * @param {Gamepad} gp
 * @returns {{ buttons: {pressed: boolean, value: number}[], axes: number[] }}
 */
export const remapGamepad = (gp) => {
  /** @type {string} */
  const id = gp.id.toLowerCase();
  /** @type {GamepadProfile | null} */
  let activeProfile = null;

  // PRIORITY: If modal is open and we have a live buffer, use it for testing
  if (kbModal.classList.contains('modal-enter') && liveEditingBuffer) {
    activeProfile = liveEditingBuffer;
  } else {
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
  }

  if (!activeProfile) {
    return {
      buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
      axes: [...gp.axes],
    };
  }

  // Apply button mapping from profile
  /** @type {{pressed: boolean, value: number}[]} */
  const mappedButtons = activeProfile.buttons.map((srcIdx) => {
    /** @type {GamepadButton | undefined} */
    const btn = gp.buttons[srcIdx];
    return btn ? { pressed: btn.pressed, value: btn.value } : { pressed: false, value: 0 };
  });

  // Apply axis mapping from profile
  /** @type {number[]} */
  const mappedAxes = activeProfile.axes.map((srcIdx) => {
    /** @type {number | undefined} */
    const axis = gp.axes[srcIdx];
    return axis !== undefined ? axis : 0;
  });

  // Handle Trigger Emulation if enabled in profile
  if (activeProfile.emulateTriggers) {
    if (
      mappedAxes.length > 4 &&
      mappedButtons[6] &&
      (mappedButtons[6].pressed || mappedAxes[4] !== 0)
    ) {
      // Normalizes the axis from [-1, 1] to [0, 1]
      /** @type {number} */
      const ltAxis = (mappedAxes[4] + 1) / 2;

      if (ltAxis > 0) {
        mappedButtons[6].pressed = true;
        mappedButtons[6].value = ltAxis;
      }
    }
    if (
      mappedAxes.length > 5 &&
      mappedButtons[7] &&
      (mappedButtons[7].pressed || mappedAxes[5] !== 0)
    ) {
      // Normalizes the axis from [-1, 1] to [0, 1]
      /** @type {number} */
      const rtAxis = (mappedAxes[5] + 1) / 2;

      if (rtAxis > 0) {
        mappedButtons[7].pressed = true;
        mappedButtons[7].value = rtAxis;
      }
    }
  }

  return { buttons: mappedButtons, axes: mappedAxes };
};

const loadCurrentKeyBinds = () => {
  /** @type {string | null} */
  const cachedBinds = localStorage.getItem('pony_kb_binds');
  if (cachedBinds) {
    try {
      currentKeyBinds = JSON.parse(cachedBinds);
      currentKeyBinds = { ...DEFAULT_KEY_BINDS, ...currentKeyBinds };
    } catch (e) {}
  }
};

loadCurrentKeyBinds();

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
