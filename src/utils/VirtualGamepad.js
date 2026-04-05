import { createRequire } from 'module';
import { gotTheLock } from '../cli.js';
import { keyCodes } from './keyCodes.js';

/** @type {NodeJS.Require} */
const require = createRequire(import.meta.url);
/** @type {Object} */
const uinput = require('../../build/Release/uinput_gamepad.node');

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

/** @type {Map<string, Object>} */
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
 * @returns {number} The internal uinput device ID, or a negative error code if it failed or limits were reached.
 */
export const getOrInitGamepad = (clientId, padIndex, padType) => {
  /** @type {string} */
  const key = `${clientId}_${padIndex}`;
  if (persistentGamepads.has(key)) return persistentGamepads.get(key).id;
  if (persistentGamepads.size >= MAX_GAMEPADS) return -2;

  /** @type {number} */
  const typeCode = padType === 'ds4' ? 1 : 0;
  /** @type {number} */
  const id = uinput.setup(typeCode);

  if (id !== -1) {
    persistentGamepads.set(key, {
      id: id,
      previousButtons: new Array(BUTTON_MAP.length).fill(false),
      previousAxes: new Array(6).fill(0),
      prevHatX: 0,
      prevHatY: 0,
    });
    console.log(`[GAMEPAD] Created persistent virtual ${padType.toUpperCase()} for [${key}]`);
  }
  return id;
};

/**
 * Destroys all currently active virtual gamepads and clears the persistent map.
 * Called when the application is shutting down.
 *
 * @returns {void}
 */
export const destroyAllGamepads = () => {
  for (const session of persistentGamepads.values()) {
    uinput.destroy(session.id);
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
      uinput.destroy(session.id);
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
  /** @type {number} */
  const id = getOrInitGamepad(clientId, padIndex, padType);
  if (id < 0) return id === -2 ? 'LIMIT_REACHED' : 'ERROR';

  /** @type {string} */
  const key = `${clientId}_${padIndex}`;
  /** @type {Object} */
  const session = persistentGamepads.get(key);
  /** @type {boolean} */
  let needsSync = false;

  // Buttons and Digital/Analog Triggers
  state.buttons.forEach((btn, i) => {
    /** @type {number|null|undefined} */
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
  return 'OK';
};

/**
 * Checks if the current process has the required Read/Write permissions to access /dev/uinput.
 *
 * @returns {boolean} True if the system grants access, false otherwise.
 */
export const canAccessUinput = () => {
  return uinput.checkPermissions();
};

if (gotTheLock) {
  if (!canAccessUinput()) {
    console.error(
      '[GAMEPAD] Error: No RW permissions for /dev/uinput. Try running with sudo or check udev rules.',
    );
  } else {
    console.log('[GAMEPAD] Permissions OK! Ready to create virtual controllers.');
  }
}
