import { createRequire } from 'module';

import { isWin, ViGEmClient } from '../../win/vigemclient.js';
import { gotTheLock } from '../cli.js';
import { keyCodes } from './keyCodes.js';

/**
 * @typedef {import('../../win/vigemclient.js').DS4Controller} DS4Controller
 * @typedef {import('../../win/vigemclient.js').X360Controller} X360Controller
 */

/**
 * @typedef {DS4Controller|X360Controller} Controller
 */

/** @type {NodeJS.Require} */
const require = createRequire(import.meta.url);
/** @type {Object | null} */
const uinput = !isWin ? require(`../../build/Release/uinput_gamepad.node`) : null;

/** @type {ViGEmClient | null} */
const vigem = isWin ? new ViGEmClient() : null;

/** @type {boolean} */
let isVigemConnected = false;

if (isWin && vigem) {
  try {
    const err = vigem.connect();
    if (err) {
      console.error('[GAMEPAD] ViGEmBus connection error:', err);
    } else {
      isVigemConnected = true;
      console.log('[GAMEPAD] ViGEmBus connected successfully.');
    }
  } catch (error) {
    console.error('[GAMEPAD] ViGEmBus connection exception:', error);
  }
}

/** @type {number} */
const EV_KEY = 0x01;
/** @type {number} */
const EV_ABS = 0x03;
/** @type {number} */
const EV_SYN = 0x00;
/** @type {number} */
const SYN_REPORT = 0x00;
/** @type {number} */
const MAX_GAMEPADS = 12;

/**
 * Maps standard Gamepad API button indices to uinput codes.
 * @type {number[]}
 */
const BUTTON_MAP = [
  keyCodes.BTN_SOUTH, // 0: A / Cross
  keyCodes.BTN_EAST, // 1: B / Circle
  keyCodes.BTN_WEST, // 2: X / Square
  keyCodes.BTN_NORTH, // 3: Y / Triangle
  keyCodes.BTN_TL, // 4: L1
  keyCodes.BTN_TR, // 5: R1
  keyCodes.BTN_TL2, // 6: L2 (Digital)
  keyCodes.BTN_TR2, // 7: R2 (Digital)
  keyCodes.BTN_SELECT, // 8: Select
  keyCodes.BTN_START, // 9: Start
  keyCodes.BTN_THUMBL, // 10: L3
  keyCodes.BTN_THUMBR, // 11: R3
  keyCodes.BTN_DPAD_UP, // 12: D-Pad Up (Handled via Axis)
  keyCodes.BTN_DPAD_DOWN, // 13: D-Pad Down (Handled via Axis)
  keyCodes.BTN_DPAD_LEFT, // 14: D-Pad Left (Handled via Axis)
  keyCodes.BTN_DPAD_RIGHT, // 15: D-Pad Right (Handled via Axis)
  keyCodes.BTN_MODE, // 16: Logo PS / Logo Xbox
];

/**
 * Standard axes: Left X, Left Y, Right X, Right Y
 * @type {number[]}
 */
const AXIS_MAP = [keyCodes.ABS_X, keyCodes.ABS_Y, keyCodes.ABS_RX, keyCodes.ABS_RY];

/**
 * @template T
 * @typedef {Object} PersistentGamepad
 * @property {T} device
 * @property {number[]} previousButtons
 * @property {number[]} previousAxes
 */

/** @type {Map<string, PersistentGamepad<number|Controller>>} */
const persistentGamepads = new Map();

/**
 * Counts how many active virtual gamepads are currently assigned to a specific client.
 *
 * @param {string} clientId - The unique identifier of the client.
 * @returns {number} The amount of gamepads associated with the client.
 */
export const getGamepadCountForClient = (clientId) => {
  /** @type {number} */
  let count = 0;
  for (const key of persistentGamepads.keys()) {
    if (key.startsWith(`${clientId}_`)) count++;
  }
  return count;
};

/**
 * Gets the total amount of active virtual gamepads across all connected clients.
 *
 * @returns {number} The total count of active virtual gamepads.
 */
export const getTotalGamepads = () => {
  return persistentGamepads.size;
};

/**
 * Retrieves an existing virtual gamepad ID for a client or initializes a new one if it doesn't exist.
 * Validates maximum connection limits before creating a new device via uinput.
 *
 * @param {string} clientId - The unique identifier of the client.
 * @param {number} padIndex - The index of the gamepad from the client's side.
 * @param {string} padType - The hardware type to emulate ('ds4' for DualShock 4 or 'xbox' for Xbox 360).
 * @returns {number|Controller} The internal uinput device ID, or a negative error code if it failed or limits were reached.
 */
export const getOrInitGamepad = (clientId, padIndex, padType) => {
  /** @type {string} */
  const key = `${clientId}_${padIndex}`;
  if (persistentGamepads.has(key)) return persistentGamepads.get(key).device;
  if (persistentGamepads.size >= MAX_GAMEPADS) return -2;

  /** @type {number | Controller} */
  let device;

  if (isWin) {
    if (!isVigemConnected || !vigem) return -1;
    device = padType === 'ds4' ? vigem.createDS4Controller() : vigem.createX360Controller();
    device.connect();
  } else {
    /** @type {number} */
    const typeCode = padType === 'ds4' ? 1 : 0;
    device = uinput.setup(typeCode);
    if (device === -1) return -1;
  }

  persistentGamepads.set(key, {
    device,
    previousButtons: new Array(BUTTON_MAP.length).fill(false),
    previousAxes: new Array(6).fill(0),
  });
  console.log(`[GAMEPAD] Created persistent virtual ${padType.toUpperCase()} for [${key}]`);

  return device;
};

/**
 * Destroys all currently active virtual gamepads and clears the persistent map.
 * Called when the application is shutting down.
 *
 * @returns {void}
 */
export const destroyAllGamepads = () => {
  for (const session of persistentGamepads.values()) {
    if (isWin) {
      session.device.disconnect();
    } else {
      uinput.destroy(session.device);
    }
  }
  persistentGamepads.clear();
};

/**
 * Destroys all virtual gamepads associated with a specific client and removes them from the persistent map.
 * Called when a client disconnects from the server.
 *
 * @param {string} clientId - The unique identifier of the client.
 * @returns {void}
 */
export const destroyGamepadsForClient = (clientId) => {
  for (const [key, session] of persistentGamepads.entries()) {
    if (key.startsWith(`${clientId}_`)) {
      if (isWin) {
        session.device.disconnect();
      } else {
        uinput.destroy(session.device);
      }
      persistentGamepads.delete(key);
      console.log(`[GAMEPAD] Destroyed and released gamepad [${key}] due to client disconnect.`);
    }
  }
};

/**
 * Translates Web Gamepad API states into kernel-level uinput events.
 * Only sends events if the state of a button or axis has changed to optimize performance.
 *
 * @param {string} clientId - The unique identifier of the client.
 * @param {number} padIndex - The index of the gamepad from the client's side.
 * @param {Object} state - The current gamepad state containing 'buttons' and 'axes' arrays.
 * @param {string} padType - The hardware type to emulate.
 * @returns {string} The status of the operation: 'OK', 'ERROR', or 'LIMIT_REACHED'.
 */
export const updateGamepadState = (clientId, padIndex, state, padType) => {
  /** @type {number | Controller} */
  const device = getOrInitGamepad(clientId, padIndex, padType);
  if (device === -2) return 'LIMIT_REACHED';
  if (device === -1) return 'ERROR';

  /** @type {string} */
  const key = `${clientId}_${padIndex}`;
  const session = persistentGamepads.get(key);

  if (isWin) {
    updateWindowsState(device, state, session, padType);
  } else {
    updateLinuxState(device, state, session);
  }

  return 'OK';
};

/**
 * @param {number} id
 * @param {Object} state
 * @param {PersistentGamepad<number>} session
 * @returns {void}
 */
const updateLinuxState = (id, state, session) => {
  /** @type {boolean} */
  let needsSync = false;

  // Buttons and Digital/Analog Triggers
  state.buttons.forEach((btn, i) => {
    /** @type {number | undefined} */
    const code = BUTTON_MAP[i];
    /** @type {boolean} */
    const isTrigger = i === 6 || i === 7;

    // Prevent collision: triggers only act as digital buttons when almost fully pressed (>= 0.95)
    // const isPressed = isTrigger ? btn.value >= 0.95 : btn.pressed;
    /** @type {boolean} */
    const isPressed = btn.pressed;

    // Safety check to prevent undefined exceptions crashing the loop
    if (code !== undefined && code !== null && isPressed !== session.previousButtons[i]) {
      session.previousButtons[i] = isPressed;
      uinput.emit(id, EV_KEY, code, isPressed ? 1 : 0);
      needsSync = true;
    }

    // Analog Triggers (LT/RT)
    if (isTrigger) {
      /** @type {number} */
      const axisCode = i === 6 ? keyCodes.ABS_Z : keyCodes.ABS_RZ;
      /** @type {number} */
      const scaledValue = Math.floor(btn.value * 255);
      /** @type {number} */
      const cacheIdx = i === 6 ? 4 : 5;

      if (scaledValue !== session.previousAxes[cacheIdx]) {
        session.previousAxes[cacheIdx] = scaledValue;
        uinput.emit(id, EV_ABS, axisCode, scaledValue);
        needsSync = true;
      }
    }
  });

  // Analog Sticks
  AXIS_MAP.forEach((code, i) => {
    /** @type {number} */
    const val = Math.floor((state.axes[i] || 0) * 32767);
    if (val !== session.previousAxes[i]) {
      session.previousAxes[i] = val;
      uinput.emit(id, EV_ABS, code, val);
      needsSync = true;
    }
  });

  if (needsSync) uinput.emit(id, EV_SYN, SYN_REPORT, 0);
};

/**
 * Synchronizes the game controller state with the Windows ViGEm device.
 *
 * @param {Controller} pad
 * @param {Object} state
 * @param {PersistentGamepad<Controller>} session
 * @param {string} padType
 * @returns {void}
 */
const updateWindowsState = (pad, state, session, padType) => {
  /** @type {boolean} */
  const isDS4 = padType === 'ds4';

  state.buttons.forEach((btn, i) => {
    /**
     * @type {boolean}
     * @description Identifies if the button corresponds to L2 or R2 analog triggers.
     */
    const isTrigger = i === 6 || i === 7;

    /**
     * @type {boolean}
     * @description Identifies if the button corresponds to the directional pad.
     */
    const isDpad = i >= 12 && i <= 15;

    /** @type {boolean} */
    const isPressed = btn.pressed;

    if (isPressed !== session.previousButtons[i]) {
      session.previousButtons[i] = isPressed;

      if (isDpad) {
        applyDpadState(pad, i, isPressed);
      } else if (!isTrigger) {
        /** @type {string | null} */
        const btnName = getWindowsButtonName(i, isDS4);
        if (btnName && pad.button && pad.button[btnName] !== undefined) {
          pad.button[btnName].setValue(isPressed);
        }
      }
    }

    if (isTrigger) {
      /** @type {number} */
      const cacheIdx = i === 6 ? 4 : 5;

      /**
       * @type {number}
       * @description Scales the trigger value from 0.0-1.0 to 0-255 for both DS4 and X360 hardware.
       */
      const scaledValue = Math.floor(btn.value * 255);

      if (scaledValue !== session.previousAxes[cacheIdx]) {
        session.previousAxes[cacheIdx] = scaledValue;

        /** @type {string} */
        const axisName = i === 6 ? 'leftTrigger' : 'rightTrigger';
        if (pad.axis && pad.axis[axisName] !== undefined) {
          pad.axis[axisName].setValue(scaledValue);
        }
      }
    }
  });

  /** @type {string[]} */
  const axisNames = ['leftX', 'leftY', 'rightX', 'rightY', 'leftTrigger', 'rightTrigger'];

  axisNames.forEach((axisName, i) => {
    /** @type {number} */
    let val = state.axes[i] || 0;

    if (i === 1 || i === 3) {
      val = -val;
    }

    /** @type {number} */
    const finalVal = isDS4 ? Math.floor(val * 127) : val;

    if (finalVal !== session.previousAxes[i]) {
      session.previousAxes[i] = finalVal;
      if (pad.axis && pad.axis[axisName] !== undefined) {
        pad.axis[axisName].setValue(finalVal);
      }
    }
  });

  if (typeof pad.update === 'function') {
    pad.update();
  }
};

/**
 * 2D Array mapping standard D-Pad indices (12-15) to various known API nomenclatures.
 * @type {[string[], { type: 'dpadVert'|'dpadHorz', value: 1|-1 }][]}
 */
const dpadVariants = [
  [['DPAD_UP', 'UP', 'DPAD_NORTH'], { type: 'dpadVert', value: 1 }], // 12
  [['DPAD_DOWN', 'DOWN', 'DPAD_SOUTH'], { type: 'dpadVert', value: -1 }], // 13
  [['DPAD_LEFT', 'LEFT', 'DPAD_WEST'], { type: 'dpadHorz', value: -1 }], // 14
  [['DPAD_RIGHT', 'RIGHT', 'DPAD_EAST'], { type: 'dpadHorz', value: 1 }], // 15
];

/**
 * Safely attempts to set a D-Pad value by dynamically checking the most common
 * properties across different ViGEmBus Node.js wrappers.
 *
 * @param {Controller} pad
 * @param {number} index
 * @param {boolean} isPressed
 * @returns {void}
 */
const applyDpadState = (pad, index, isPressed) => {
  const variants = dpadVariants[index - 12];

  for (const variant of variants[0]) {
    if (pad.button && pad.button[variant] !== undefined) {
      pad.button[variant].setValue(isPressed);
      return; // Stop searching once the correct property is found
    }
    if (pad.dpad && pad.dpad[variant] !== undefined) {
      pad.dpad[variant].setValue(isPressed);
      return; // Stop searching once the correct property is found
    }
  }
  if (pad.axis && pad.axis[variants[1].type] !== undefined) {
    pad.axis[variants[1].type].setValue(isPressed ? variants[1].value : 0);
  }
};

/**
 * Retrieves the proper API string identifier for regular buttons.
 *
 * @param {number} index
 * @param {boolean} isDS4
 * @returns {string | null}
 */
const getWindowsButtonName = (index, isDS4) => {
  /**
   * @type {Record<number, string>}
   * @description Standard mapping for X360 buttons, excluding D-Pad and Triggers.
   */
  const x360Map = {
    0: 'A',
    1: 'B',
    2: 'X',
    3: 'Y',
    4: 'LEFT_SHOULDER',
    5: 'RIGHT_SHOULDER',
    8: 'BACK',
    9: 'START',
    10: 'LEFT_THUMB',
    11: 'RIGHT_THUMB',
    16: 'GUIDE',
  };

  /**
   * @type {Record<number, string>}
   * @description Standard mapping for DS4 buttons, excluding D-Pad and Triggers.
   */
  const ds4Map = {
    0: 'CROSS',
    1: 'CIRCLE',
    2: 'SQUARE',
    3: 'TRIANGLE',
    4: 'L1',
    5: 'R1',
    8: 'SHARE',
    9: 'OPTIONS',
    10: 'L3',
    11: 'R3',
    16: 'PS',
  };

  return isDS4 ? ds4Map[index] || null : x360Map[index] || null;
};

/**
 * Checks if the current process has the required Read/Write permissions to access /dev/uinput.
 *
 * @returns {boolean} True if the system grants access, false otherwise.
 */
export const canAccessUinput = () => {
  return isWin ? isVigemConnected : uinput.checkPermissions();
};

if (gotTheLock) {
  if (!canAccessUinput()) {
    console.error(
      isWin
        ? '[GAMEPAD] Error: ViGEmBus is not connected. Controllers will not be created.'
        : '[GAMEPAD] Error: No RW permissions for /dev/uinput. Try running with sudo or check udev rules.',
    );
  } else {
    console.log('[GAMEPAD] Permissions OK! Ready to create virtual controllers.');
  }
}
