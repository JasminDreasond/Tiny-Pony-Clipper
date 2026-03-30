/**
 * @param {string} title
 * @param {string} body
 * @returns {void}
 */
export const sendBackgroundNotification = (title, body) => {
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon/192.png' });
  }
};
