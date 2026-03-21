/** @type {HTMLInputElement} */
const savePathInput = document.getElementById('savePath');

/** @type {HTMLButtonElement} */
const btnBrowse = document.getElementById('btnBrowse');

/** @type {HTMLButtonElement} */
const btnApply = document.getElementById('btnApply');

const init = async () => {
    console.log('[RENDERER] Initializing UI components...');
    savePathInput.value = await window.electronAPI.getDefaultPath();
    console.log(`[RENDERER] Default save path loaded: ${savePathInput.value}`);
};

btnBrowse.addEventListener('click', async () => {
    console.log('[RENDERER] Browse button clicked.');
    const folder = await window.electronAPI.selectFolder();
    if (folder) {
        savePathInput.value = folder;
        console.log(`[RENDERER] New save path set in UI: ${folder}`);
    }
});

btnApply.addEventListener('click', () => {
    console.log('[RENDERER] Apply button clicked. Gathering configuration...');
    
    const config = {
        minutes: Number(document.getElementById('bufferMinutes').value),
        sysInput: document.getElementById('sysInput').value,
        micInput: document.getElementById('micInput').value,
        separateAudio: document.getElementById('separateAudio').checked,
        shortcut: document.getElementById('shortcutKey').value,
        savePath: savePathInput.value
    };

    console.log('[RENDERER] Configuration gathered:', config);
    console.log('[RENDERER] Sending configuration to Main process via IPC.');
    
    window.electronAPI.applySettings(config);
    alert('Settings applied! Recording started in background. Check terminal for debugs.');
});

init();