import fs from 'fs';
import { srcFolder, windowsCache } from './values.js';

/**
 * Accepting only audio files that are in the "src" folder.
 * @param {string} [soundFile]
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
