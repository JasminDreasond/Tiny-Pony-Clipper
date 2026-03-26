import fs from 'fs';
import { srcFolder, windowsCache } from './values.js';

/**
 * Instructs the hidden capture window to play an audio file.
 * Accepts only audio files located within the "src" folder for security.
 *
 * @param {string} [soundFile] - The absolute path to the audio file.
 * @returns {void}
 */
export const playAudio = (soundFile) => {
  if (!windowsCache.captureWindow) {
    console.warn('[SYSTEM WARN] Capture Window not found. The sound failed:', soundFile);
    return;
  }
  if (soundFile.startsWith(srcFolder)) {
    if (fs.existsSync(soundFile)) {
      windowsCache.captureWindow.webContents.send(
        'play-sound',
        `./${soundFile.substring(srcFolder.length, soundFile.length)}`,
      );
    } else console.warn('[SYSTEM WARN] Sound file not found:', soundFile);
  } else console.warn('[SYSTEM WARN] Invalid Sound path:', soundFile);
};
