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
/** @type {number} */
const MAX_GAMEPADS = 4;

// -1 means it is an analog trigger and should be handled as an axis, not a key.
/** @type {number[]} */
const BUTTON_MAP = [
  0x130, // 0: A / Cross
  0x131, // 1: B / Circle
  0x133, // 2: X / Square
  0x134, // 3: Y / Triangle
  0x136, // 4: LB / L1
  0x137, // 5: RB / R1
  -1, // 6: LT / L2 (Analog Axis)
  -1, // 7: RT / R2 (Analog Axis)
  0x13a, // 8: Select / Share
  0x13b, // 9: Start / Options
  0x13d, // 10: L3 (Left Stick Click)
  0x13e, // 11: R3 (Right Stick Click)
  0x220, // 12: D-Pad Up
  0x221, // 13: D-Pad Down
  0x222, // 14: D-Pad Left
  0x223, // 15: D-Pad Right
  0x13c, // 16: Home / Guide
];

/** @type {number[]} */
const AXIS_MAP = [0x00, 0x01, 0x03, 0x04]; // Left X, Left Y, Right X, Right Y

/**
 * @typedef {Object} GamepadSession
 * @property {number} id
 * @property {boolean[]} previousButtons
 * @property {number[]} previousAxes
 */

/** @type {Map<number, GamepadSession>} */
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
      previousAxes: new Array(6).fill(0), // 0-3 for sticks, 4-5 for L2/R2 triggers
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

  if (id === -2) return 'LIMIT_REACHED';
  if (id === -1) return 'ERROR';

  /** @type {GamepadSession} */
  const session = persistentGamepads.get(padIndex);
  /** @type {boolean} */
  let needsSync = false;

  for (let i = 0; i < BUTTON_MAP.length; i++) {
    /** @type {Object} */
    const btn = state.buttons[i];
    if (!btn) continue;

    if (i === 6 || i === 7) {
      // Handle L2 and R2 as Analog Axes (ABS_Z and ABS_RZ)
      /** @type {number} */
      const axisCode = i === 6 ? 0x02 : 0x05; // 0x02 = ABS_Z, 0x05 = ABS_RZ
      /** @type {number} */
      const scaledValue = Math.floor(btn.value * 255); // 0 to 255 for triggers

      // We use index 4 and 5 in our previousAxes array to store trigger states
      /** @type {number} */
      const cacheIndex = i === 6 ? 4 : 5;

      if (scaledValue !== session.previousAxes[cacheIndex]) {
        session.previousAxes[cacheIndex] = scaledValue;
        uinput.emit(id, EV_ABS, axisCode, scaledValue);
        needsSync = true;
      }
    } else if (BUTTON_MAP[i] !== -1) {
      // Normal digital buttons
      if (btn.pressed !== session.previousButtons[i]) {
        session.previousButtons[i] = btn.pressed;
        uinput.emit(id, EV_KEY, BUTTON_MAP[i], btn.pressed ? 1 : 0);
        needsSync = true;
      }
    }
  }

  // Handle Analog Sticks
  for (let i = 0; i < AXIS_MAP.length; i++) {
    if (state.axes[i] !== undefined) {
      /** @type {number} */
      const scaledValue = Math.floor(state.axes[i] * 32767);
      if (scaledValue !== session.previousAxes[i]) {
        session.previousAxes[i] = scaledValue;
        uinput.emit(id, EV_ABS, AXIS_MAP[i], scaledValue);
        needsSync = true;
      }
    }
  }

  if (needsSync) uinput.emit(id, EV_SYN, SYN_REPORT, 0);
  return 'OK';
};
