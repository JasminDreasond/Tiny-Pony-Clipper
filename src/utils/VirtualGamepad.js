import { createRequire } from 'module';

/** @type {NodeRequire} */
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

/** @type {number[]} */
const BUTTON_MAP = [
  0x130, // 0: A
  0x131, // 1: B
  0x133, // 2: X
  0x134, // 3: Y
  0x136, // 4: LB
  0x137, // 5: RB
  0x138, // 6: LT (Also triggers axis)
  0x139, // 7: RT (Also triggers axis)
  0x13a, // 8: Select
  0x13b, // 9: Start
  0x13d, // 10: L3
  0x13e, // 11: R3
  0x220, // 12: D-Pad Up
  0x221, // 13: D-Pad Down
  0x222, // 14: D-Pad Left
  0x223, // 15: D-Pad Right
  0x13c, // 16: Home
];

/** @type {number[]} */
const AXIS_MAP = [
  0x00, // 0: Left Stick X
  0x01, // 1: Left Stick Y
  0x03, // 2: Right Stick X
  0x04, // 3: Right Stick Y
];

/** @type {boolean[]} */
const previousButtons = new Array(17).fill(false);

/** @type {number[]} */
const previousAxes = new Array(4).fill(0);

/**
 * @returns {boolean}
 */
export const initVirtualGamepad = () => {
  return uinput.setup();
};

/**
 * @returns {void}
 */
export const destroyVirtualGamepad = () => {
  uinput.destroy();
};

/**
 * @param {number} type
 * @param {number} code
 * @param {number} value
 * @returns {void}
 */
const sendEvent = (type, code, value) => {
  uinput.emit(type, code, value);
};

/**
 * @returns {void}
 */
const syncEvents = () => {
  uinput.emit(EV_SYN, SYN_REPORT, 0);
};

/**
 * @param {Object} state
 * @param {boolean[]} state.buttons
 * @param {number[]} state.axes
 * @returns {void}
 */
export const updateGamepadState = (state) => {
  /** @type {boolean} */
  let needsSync = false;

  for (let i = 0; i < BUTTON_MAP.length; i++) {
    if (state.buttons[i] !== undefined && state.buttons[i] !== previousButtons[i]) {
      previousButtons[i] = state.buttons[i];
      sendEvent(EV_KEY, BUTTON_MAP[i], state.buttons[i] ? 1 : 0);
      needsSync = true;
    }
  }

  for (let i = 0; i < AXIS_MAP.length; i++) {
    if (state.axes[i] !== undefined) {
      /** @type {number} */
      const scaledValue = Math.floor(state.axes[i] * 32767);

      if (scaledValue !== previousAxes[i]) {
        previousAxes[i] = scaledValue;
        sendEvent(EV_ABS, AXIS_MAP[i], scaledValue);
        needsSync = true;
      }
    }
  }

  if (needsSync) {
    syncEvents();
  }
};
