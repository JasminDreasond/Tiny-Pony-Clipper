import { Notification } from 'electron';
import { appIconPath } from './values.js';
import { playAudio } from './Audio.js';

/**
 * Creates and displays an Electron system notification. Optionally plays a sound and handles click events.
 * Accepts only audio files located within the "src" folder.
 *
 * @param {Electron.NotificationConstructorOptions} options - Configuration options for the notification.
 * @param {string} [soundFile] - Optional absolute path to an audio file to play alongside the notification.
 * @param {(details: Electron.Event<Electron.NotificationActionEventParams>, actionIndex: number, selectionIndex: number) => void} [onClick] - Optional callback function triggered when the notification is clicked.
 * @returns {Electron.Notification} The generated Notification instance.
 */
export const sendNotification = (options, soundFile, onClick) => {
  /** @type {Electron.Notification} */
  const noti = new Notification({
    icon: appIconPath,
    urgency: 'normal',
    ...options,
    silent: true,
    timeoutType: 'default',
  });

  if (onClick) noti.on('click', onClick);
  noti.show();
  if (soundFile) playAudio(soundFile);
  return noti;
};
