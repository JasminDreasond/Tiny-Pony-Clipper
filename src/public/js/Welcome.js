/** @type {HTMLElement | null} */
const welcomeScreen = document.getElementById('welcomeScreen');
/** @type {HTMLElement | null} */
const btnStartApp = document.getElementById('btnStartApp');
/** @type {HTMLElement | null} */
const playtimeDisplay = document.getElementById('playtimeDisplay');

/** @type {number} */
let totalPlaytimeMinutes = parseInt(localStorage.getItem('pony_total_playtime') || '0', 10);
/** @type {NodeJS.Timeout | null} */
let playTimer = null;

if (playtimeDisplay) {
  if (totalPlaytimeMinutes === 0) {
    playtimeDisplay.textContent = 'Welcome, New Player! ✨';
  } else {
    /** @type {number} */
    const h = Math.floor(totalPlaytimeMinutes / 60);
    /** @type {number} */
    const m = totalPlaytimeMinutes % 60;
    playtimeDisplay.textContent = `Total Playtime: ${h > 0 ? h + 'h ' : ''}${m}m 🎮`;
  }
}

/**
 * @returns {void}
 */
export const startPlayTimer = () => {
  if (playTimer) return;
  playTimer = setInterval(() => {
    totalPlaytimeMinutes += 1;
    localStorage.setItem('pony_total_playtime', totalPlaytimeMinutes.toString());
  }, 60000);
};

/**
 * @returns {void}
 */
export const stopPlayTimer = () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
};

/**
 * Hides the welcome screen and reveals the login panel.
 * Triggered manually by the user or automatically by background API routines.
 *
 * @returns {void}
 */
export const bypassWelcome = () => {
  if (welcomeScreen && welcomeScreen.style.display !== 'none') {
    welcomeScreen.style.display = 'none';
    loginDiv.style.display = 'flex';
  }
};

if (btnStartApp) {
  btnStartApp.addEventListener('click', bypassWelcome);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && welcomeScreen && welcomeScreen.style.display !== 'none') {
    bypassWelcome();
  }
});

/**
 * @returns {void}
 */
const pollWelcomeGamepad = () => {
  if (welcomeScreen && welcomeScreen.style.display === 'none') return;

  /** @type {Gamepad[]} */
  const gamepads = navigator.getGamepads();
  for (let i = 0; i < gamepads.length; i++) {
    /** @type {Gamepad|null} */
    const gp = gamepads[i];
    if (gp && gp.buttons.some((b) => b.pressed)) {
      bypassWelcome();
      return;
    }
  }

  requestAnimationFrame(pollWelcomeGamepad);
};

if (welcomeScreen) {
  requestAnimationFrame(pollWelcomeGamepad);
}
