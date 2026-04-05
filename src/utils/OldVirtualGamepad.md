```js
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
```
