import path from 'path';
import { fileURLToPath } from 'url';
import { screen } from 'electron';
import { execSync, spawnSync } from 'child_process';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

export const windowsCache = {
  /** @type {Electron.CrossProcessExports.BrowserWindow | null} */
  configWindow: null,
  /** @type {Electron.CrossProcessExports.BrowserWindow | null} */
  captureWindow: null,
};

export const rootFolder = path.join(__dirname, '../../');

export const srcFolder = path.join(rootFolder, './src');

/** @type {string} */
export const appIconPath = path.join(srcFolder, './icons/tray-icon.png');

/** @type {string} */
export const appIconProcessingPath = path.join(srcFolder, './icons/tray-icon-processing.png');

/**
 * Queries the system for available monitors and audio devices (inputs and outputs) using Electron and PulseAudio.
 *
 * @returns {{ monitors: Object[], audioOutputs: Object[], audioInputs: Object[] }} An object containing lists of available hardware.
 */
export const getHardwareInfo = () => {
  /** @type {Object[]} */
  const monitors = screen.getAllDisplays().map((disp, index) => ({
    id: String(index),
    name: `Monitor ${index + 1} (${disp.bounds.width}x${disp.bounds.height})`,
    bounds: disp.bounds,
  }));

  /** @type {Object[]} */
  const audioOutputs = [{ id: 'default', name: 'Default System Audio' }];

  /** @type {Object[]} */
  const audioInputs = [
    { id: 'none', name: 'Disabled' },
    { id: 'default', name: 'Default Microphone' },
  ];

  try {
    /** @type {string} */
    const output = execSync('pactl -f json list sources', { encoding: 'utf-8' });

    /** @type {Object[]} */
    const sources = JSON.parse(output);

    for (const source of sources) {
      /** @type {string} */
      const id = source.name;
      /** @type {string} */
      const humanName = source.description || id;

      if (id.endsWith('.monitor')) {
        audioOutputs.push({ id: id, name: humanName });
      } else {
        audioInputs.push({ id: id, name: humanName });
      }
    }
  } catch (error) {
    console.error('[SYSTEM] Failed to fetch PulseAudio JSON devices.', error);
  }

  return { monitors, audioOutputs, audioInputs };
};

/**
 * @returns {boolean}
 */
export const isFFmpegInstalled = () => {
  try {
    const result = spawnSync('ffmpeg', ['-version']);
    return !result.error;
  } catch (e) {
    return false;
  }
};
