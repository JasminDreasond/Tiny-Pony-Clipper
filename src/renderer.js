/** @type {HTMLInputElement} */
const savePathInput = document.getElementById('savePath');

/** @type {HTMLButtonElement} */
const btnBrowse = document.getElementById('btnBrowse');

/** @type {HTMLButtonElement} */
const btnApply = document.getElementById('btnApply');

/** @type {HTMLInputElement} */
const shortcutInput = document.getElementById('shortcutKey');

/**
 * @param {KeyboardEvent} event
 * @returns {void}
 */
const handleShortcutCapture = (event) => {
    event.preventDefault();
    
    /** @type {string[]} */
    const keys = [];
    
    if (event.ctrlKey) keys.push('CommandOrControl');
    if (event.altKey) keys.push('Alt');
    if (event.shiftKey) keys.push('Shift');
    if (event.metaKey) keys.push('Super');

    /** @type {string} */
    const key = event.key;
    
    /** @type {string[]} */
    const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];
    
    if (!modifiers.includes(key)) {
        /** @type {string} */
        const formattedKey = key.length === 1 ? key.toUpperCase() : key;
        keys.push(formattedKey);
        shortcutInput.value = keys.join('+');
    }
};

/**
 * @returns {Promise<void>}
 */
const init = async () => {
    console.log('[RENDERER] Loading saved configuration...');
    
    /** @type {Object} */
    const config = await window.electronAPI.getConfig();
    
    /** @type {HTMLInputElement} */
    const bufferMinutesInput = document.getElementById('bufferMinutes');
    bufferMinutesInput.value = String(config.minutes);
    
    /** @type {HTMLInputElement} */
    const sysInputNode = document.getElementById('sysInput');
    sysInputNode.value = config.sysInput;
    
    /** @type {HTMLInputElement} */
    const micInputNode = document.getElementById('micInput');
    micInputNode.value = config.micInput;
    
    /** @type {HTMLInputElement} */
    const separateAudioCheckbox = document.getElementById('separateAudio');
    separateAudioCheckbox.checked = config.separateAudio;
    
    shortcutInput.value = config.shortcut;
    savePathInput.value = config.savePath;

    shortcutInput.addEventListener('keydown', handleShortcutCapture);
};

btnBrowse.addEventListener('click', async () => {
    console.log('[RENDERER] Browse button clicked.');
    /** @type {string | null} */
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
        savePathInput.value = folder;
        console.log(`[RENDERER] New save path set in UI: ${folder}`);
    }
});

btnApply.addEventListener('click', async () => {
    console.log('[RENDERER] Apply button clicked. Gathering configuration...');
    /** @type {HTMLInputElement} */
    const bufferMinutesInput = document.getElementById('bufferMinutes');
    /** @type {HTMLInputElement} */
    const sysInputNode = document.getElementById('sysInput');
    /** @type {HTMLInputElement} */
    const micInputNode = document.getElementById('micInput');
    /** @type {HTMLInputElement} */
    const separateAudioCheckbox = document.getElementById('separateAudio');

    /** @type {Object} */
    const config = {
        minutes: Number(bufferMinutesInput.value),
        sysInput: sysInputNode.value,
        micInput: micInputNode.value,
        separateAudio: separateAudioCheckbox.checked,
        shortcut: shortcutInput.value,
        savePath: savePathInput.value
    };

    console.log('[RENDERER] Configuration gathered:', config);
    console.log('[RENDERER] Sending configuration to Main process via IPC.');

    /** @type {boolean} */
    const success = await window.electronAPI.saveConfig(config);
    if (success) {
        alert('Settings saved successfully!');
    }
});

init();