import path from 'path';
import { fileURLToPath } from 'url';
import { screen } from 'electron';
import { execSync } from 'child_process';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

export const rootFolder = path.join(__dirname, '../../');

export const srcFolder = path.join(rootFolder, './src');

export const assetsFolder = path.join(rootFolder, './assets');

/** @type {string} */
export const appIconPath = path.join(assetsFolder, './icons/tray-icon.png');

/**
 * @returns {{ monitors: Object[], audioOutputs: Object[], audioInputs: Object[] }}
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
