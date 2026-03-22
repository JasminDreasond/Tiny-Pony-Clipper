import path from 'path';
import { fileURLToPath } from 'url';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

/** @type {string} */
export const appIconPath = path.join(__dirname, '../assets/tray-icon.png');
