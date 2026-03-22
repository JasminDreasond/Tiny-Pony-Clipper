import { Notification } from 'electron';

import { spawn } from 'child_process';
import fs from 'fs';
import { appIconPath } from '../values.js';

/**
 * @param {Electron.NotificationConstructorOptions} options
 * @param {string} [soundFile]
 * @param {(details: Electron.Event<Electron.NotificationActionEventParams>, actionIndex: number, selectionIndex: number) => void} [onClick]
 * @returns {Electron.Notification}
 */
export const sendNotification = (options, soundFile, onClick) => {
  /** @type {Electron.Notification} */
  const noti = new Notification({
    icon: appIconPath,
    ...options,
    silent: true,
    timeoutType: 'default',
  });

  if (onClick) {
    noti.on('click', onClick);
  }

  noti.show();

  if (soundFile) {
    if (fs.existsSync(soundFile)) {
      spawn('paplay', [soundFile], { detached: true, stdio: 'ignore' }).on('error', (err) => {
        console.error('[SYSTEM ERROR] Failed to play notification sound via paplay:', err);
      });
    } else {
      console.warn('[SYSTEM WARN] Notification sound file not found:', soundFile);
    }
  }

  return noti;
};
