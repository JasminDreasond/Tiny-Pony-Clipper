
import { createRequire } from 'module';
import { platform } from 'os';

export const isWin = platform() === 'win32';

/** @type {NodeJS.Require} */
const require = createRequire(import.meta.url);

/** @type {import('vigemclient')|null} */
export const ViGEmClient = isWin ? require('vigemclient') : null;
