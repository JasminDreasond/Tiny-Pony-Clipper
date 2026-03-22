import path from 'path';
import { fileURLToPath } from 'url';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

export const rootFolder = path.join(__dirname, '../../');

export const srcFolder = path.join(rootFolder, './src');

export const assetsFolder = path.join(rootFolder, './assets');

/** @type {string} */
export const appIconPath = path.join(assetsFolder, './icons/tray-icon.png');
