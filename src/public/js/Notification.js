/** @type {HTMLAudioElement} */
const notifySound = new Audio('/sounds/notify.mp3');
notifySound.preload = 'auto';

/**
 * Sends a background desktop notification with an audio alert.
 * It detects if the user is away and plays a sound, resetting it if already playing.
 * Clicking the notification will bring the application window back to focus.
 *
 * @param {string} title - The title of the desktop notification.
 * @param {string} body - The message body of the desktop notification.
 * @returns {boolean}
 */
export const sendBackgroundNotification = (title, body) => {
  /** @type {boolean} */
  const isAway = document.hidden || !document.hasFocus();

  /** @type {boolean} */
  const canNotify = 'Notification' in window && Notification.permission === 'granted';

  if (isAway && canNotify) {
    // Audio Reset Logic
    notifySound.pause();
    notifySound.currentTime = 0;
    notifySound.play().catch(() => {
      console.warn('[AUDIO] Playback failed. User interaction might be required.');
    });

    const notification = new Notification(title, {
      body,
      icon: '/icon/192.png',
      silent: true, // Prevents default system sound to use our custom audio instead
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  }
  return false;
};

window.testNotification = () =>
  sendBackgroundNotification('Tiny Test', 'My tiny pudding is here :3');
