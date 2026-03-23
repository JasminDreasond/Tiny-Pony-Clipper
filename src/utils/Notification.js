import { Notification } from 'electron';
import { appIconPath } from './values.js';
import { playAudio } from './Audio.js';

/**
 * Accepting only audio files that are in the "src" folder.
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

  if (onClick) noti.on('click', onClick);
  noti.show();
  if (soundFile) playAudio(soundFile);
  return noti;
};
