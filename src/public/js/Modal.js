// Modal
import { customAlertModal, customAlertText, btnCustomAlertOk } from './html.js';

/**
 * @param {string} msg
 * @returns {void}
 */
export const showAlert = (msg) => {
  customAlertText.textContent = msg;
  customAlertModal.style.display = 'flex';
  btnCustomAlertOk.focus();
};

btnCustomAlertOk.addEventListener('click', () => {
  customAlertModal.style.display = 'none';
});

window.addEventListener('keydown', (e) => {
  if (customAlertModal.style.display === 'flex' && (e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    customAlertModal.style.display = 'none';
  }
});
