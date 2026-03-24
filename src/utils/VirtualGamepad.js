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

/**
 * Maps standard Gamepad API button indices to Linux uinput BTN_ constants.
 * Note: D-Pad (12-15) is handled separately as Hat Axes.
 * @type {number[]}
 */
const BUTTON_MAP = [
  0x130, // 0: A / Cross (BTN_SOUTH)
  0x131, // 1: B / Circle (BTN_EAST)
  0x133, // 2: X / Square (BTN_WEST)
  0x134, // 3: Y / Triangle (BTN_NORTH)
  0x136, // 4: LB / L1 (BTN_TL)
  0x137, // 5: RB / R1 (BTN_TR)
  -1, // 6: LT / L2 (Handled as Axis)
  -1, // 7: RT / R2 (Handled as Axis)
  0x13a, // 8: Select / Share (BTN_SELECT)
  0x13b, // 9: Start / Options (BTN_START)
  0x13d, // 10: L3 (BTN_THUMBL)
  0x13e, // 11: R3 (BTN_THUMBR)
  -2, // 12: D-Pad Up (Handled as Axis)
  -2, // 13: D-Pad Down (Handled as Axis)
  -2, // 14: D-Pad Left (Handled as Axis)
  -2, // 15: D-Pad Right (Handled as Axis)
  0x13c, // 16: Guide / PS Home (BTN_MODE)
];

/** * Standard axes: Left X, Left Y, Right X, Right Y
 * @type {number[]}
 */
const AXIS_MAP = [0x00, 0x01, 0x03, 0x04];

/**
 * @typedef {Object} GamepadSession
 * @property {number} id
 * @property {boolean[]} previousButtons
 * @property {number[]} previousAxes
 * @property {number} prevHatX
 * @property {number} prevHatY
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

  if (id === -2) return 'LIMIT_REACHED';
  if (id === -1) return 'ERROR';

  /** @type {GamepadSession} */
  const session = persistentGamepads.get(padIndex);
  /** @type {boolean} */
  let needsSync = false;

  // Handle Buttons and Triggers
  for (let i = 0; i < BUTTON_MAP.length; i++) {
    /** @type {Object} */
    const btn = state.buttons[i];
    if (!btn) continue;

    if (i === 6 || i === 7) {
      /** @type {number} */
      const axisCode = i === 6 ? 0x02 : 0x05; // ABS_Z (LT) or ABS_RZ (RT)
      /** @type {number} */
      const scaledValue = Math.floor(btn.value * 255);
      /** @type {number} */
      const cacheIndex = i === 6 ? 4 : 5;

      if (scaledValue !== session.previousAxes[cacheIndex]) {
        session.previousAxes[cacheIndex] = scaledValue;
        uinput.emit(id, EV_ABS, axisCode, scaledValue);
        needsSync = true;
      }
    } else if (BUTTON_MAP[i] >= 0) {
      if (btn.pressed !== session.previousButtons[i]) {
        session.previousButtons[i] = btn.pressed;
        uinput.emit(id, EV_KEY, BUTTON_MAP[i], btn.pressed ? 1 : 0);
        needsSync = true;
      }
    }
  }

  // Handle D-Pad as Hat Axes
  /** @type {number} */
  let hatX = 0;
  if (state.buttons[14]?.pressed)
    hatX = -1; // Left
  else if (state.buttons[15]?.pressed) hatX = 1; // Right

  /** @type {number} */
  let hatY = 0;
  if (state.buttons[12]?.pressed)
    hatY = -1; // Up
  else if (state.buttons[13]?.pressed) hatY = 1; // Down

  if (hatX !== session.prevHatX) {
    session.prevHatX = hatX;
    uinput.emit(id, EV_ABS, 0x10, hatX); // ABS_HAT0X
    needsSync = true;
  }
  if (hatY !== session.prevHatY) {
    session.prevHatY = hatY;
    uinput.emit(id, EV_ABS, 0x11, hatY); // ABS_HAT0Y
    needsSync = true;
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
