import { customAlertModal, customAlertText, btnCustomAlertOk, modalOverlay } from './html.js';

/** @type {Set<HTMLElement>} */
const activeModals = new Set();

/**
 * @param {HTMLElement} modalEl
 * @returns {void}
 */
export const openModal = (modalEl) => {
  modalOverlay.classList.remove('overlay-exit');
  modalOverlay.classList.add('overlay-enter');

  modalEl.classList.remove('modal-exit');
  modalEl.classList.add('modal-enter');
  activeModals.add(modalEl);
};

/**
 * @param {HTMLElement} modalEl
 * @returns {void}
 */
export const closeModal = (modalEl) => {
  modalEl.classList.remove('modal-enter');
  modalEl.classList.add('modal-exit');
  activeModals.delete(modalEl);

  if (activeModals.size === 0) {
    modalOverlay.classList.remove('overlay-enter');
    modalOverlay.classList.add('overlay-exit');
  }

  setTimeout(() => {
    if (modalEl.classList.contains('modal-exit')) {
      modalEl.classList.remove('modal-exit');
      modalEl.style.display = 'none';
    }
    if (activeModals.size === 0 && modalOverlay.classList.contains('overlay-exit')) {
      modalOverlay.classList.remove('overlay-exit');
    }
  }, 300);
};

/**
 * @param {string} msg
 * @returns {void}
 */
export const showAlert = (msg) => {
  customAlertText.textContent = msg;
  openModal(customAlertModal);
  btnCustomAlertOk.focus();
};

btnCustomAlertOk.addEventListener('click', () => {
  closeModal(customAlertModal);
});

window.addEventListener('keydown', (e) => {
  if (
    customAlertModal.classList.contains('modal-enter') &&
    (e.key === 'Enter' || e.key === 'Escape')
  ) {
    e.preventDefault();
    closeModal(customAlertModal);
  }
});
