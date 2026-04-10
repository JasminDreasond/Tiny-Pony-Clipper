
import { createRequire } from 'module';
import { platform } from 'os';

export const isWin = platform() === 'win32';

/**
 * @typedef {import('vigemclient/lib/DS4Controller')} DS4Controller
 * @typedef {import('vigemclient/lib/X360Controller')} X360Controller
 */

/** @type {NodeJS.Require} */
const require = createRequire(import.meta.url);

/** @type {import('vigemclient')|null} */
export const ViGEmClient = isWin ? require('vigemclient') : null;
