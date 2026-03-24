import { createRequire } from 'module';
import { keyCodes } from './keyCodes.js'; // Assuming it's in the same or accessible folder

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
const MAX_GAMEPADS = 4;

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
  null, // 12: D-Pad Up (Handled via Axis)
  null, // 13: D-Pad Down (Handled via Axis)
  null, // 14: D-Pad Left (Handled via Axis)
  null, // 15: D-Pad Right (Handled via Axis)
  keyCodes.BTN_MODE, // 16: Guide/Home
];

/** * Standard axes: Left X, Left Y, Right X, Right Y
 * @type {number[]}
 */
const AXIS_MAP = [keyCodes.ABS_X, keyCodes.ABS_Y, keyCodes.ABS_RX, keyCodes.ABS_RY];

/** @type {Map<number, Object>} */
const persistentGamepads = new Map();

/**
 * @param {number} padIndex
 * @param {string} padType
 * @returns {number}
 */
export const getOrInitGamepad = (padIndex, padType) => {
  if (persistentGamepads.has(padIndex)) return persistentGamepads.get(padIndex).id;
  if (persistentGamepads.size >= MAX_GAMEPADS) return -2;

  /** @type {number} */
  const typeCode = padType === 'ds4' ? 1 : 0;
  /** @type {number} */
  const id = uinput.setup(typeCode);

  if (id !== -1) {
    persistentGamepads.set(padIndex, {
      id: id,
      previousButtons: new Array(17).fill(false),
      previousAxes: new Array(6).fill(0),
      prevHatX: 0,
      prevHatY: 0,
    });
    console.log(
      `[GAMEPAD] Created persistent virtual ${padType.toUpperCase()} for index ${padIndex}`,
    );
  }
  return id;
};

/**
 * @returns {void}
 */
export const destroyAllGamepads = () => {
  for (const session of persistentGamepads.values()) {
    uinput.destroy(session.id);
  }
  persistentGamepads.clear();
};

/**
 * @param {number} padIndex
 * @param {Object} state
 * @param {string} padType
 * @returns {string}
 */
export const updateGamepadState = (padIndex, state, padType) => {
  /** @type {number} */
  const id = getOrInitGamepad(padIndex, padType);
  if (id < 0) return id === -2 ? 'LIMIT_REACHED' : 'ERROR';

  /** @type {Object} */
  const session = persistentGamepads.get(padIndex);
  /** @type {boolean} */
  let needsSync = false;

  // Buttons and Digital Triggers
  state.buttons.forEach((btn, i) => {
    /** @type {number|null} */
    const code = BUTTON_MAP[i];
    if (code !== null && btn.pressed !== session.previousButtons[i]) {
      session.previousButtons[i] = btn.pressed;
      uinput.emit(id, EV_KEY, code, btn.pressed ? 1 : 0);
      needsSync = true;
    }

    // Analog Triggers (LT/RT)
    if (i === 6 || i === 7) {
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

  // D-Pad Logic (Hat Axes)
  /** @type {number} */
  const hatX = (state.buttons[15]?.pressed ? 1 : 0) - (state.buttons[14]?.pressed ? 1 : 0);
  /** @type {number} */
  const hatY = (state.buttons[13]?.pressed ? 1 : 0) - (state.buttons[12]?.pressed ? 1 : 0);

  if (hatX !== session.prevHatX) {
    session.prevHatX = hatX;
    uinput.emit(id, EV_ABS, keyCodes.ABS_HAT0X, hatX);
    needsSync = true;
  }
  if (hatY !== session.prevHatY) {
    session.prevHatY = hatY;
    uinput.emit(id, EV_ABS, keyCodes.ABS_HAT0Y, hatY);
    needsSync = true;
  }

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

  if (needsSync) uinput.emit(id, EV_SYN, keyCodes.SYN_REPORT || 0, 0);
  return 'OK';
};
