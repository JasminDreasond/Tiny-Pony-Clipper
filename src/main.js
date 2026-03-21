import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, dialog } from 'electron';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

/** @type {BrowserWindow | null} */
let configWindow = null;

/** @type {Tray | null} */
let tray = null;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let ffmpegProcess = null;

/** @type {NodeJS.Timeout | null} */
let cleanupInterval = null;

/** @type {string} */
const TEMP_DIR = path.join(os.tmpdir(), 'pony_clipper_segments');

/**
 * @param {string} dirPath
 * @returns {boolean}
 */
const isDirectoryValid = (dirPath) => {
    try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch (e) {
        return false;
    }
};

/**
 * @returns {void}
 */
const ensureKmsgrabPermissions = () => {
    try {
        /** @type {string} */
        const ffmpegPath = execSync('which ffmpeg').toString().trim();
        /** @type {string} */
        let caps = '';
        
        try {
            caps = execSync(`getcap ${ffmpegPath}`).toString();
        } catch (e) {
            // Ignore error if getcap returns nothing
        }

        if (!caps.includes('cap_sys_admin')) {
            console.log('[SYSTEM] ffmpeg lacks KMSGrab permissions. Prompting user for authorization...');
            execSync(`pkexec setcap cap_sys_admin,cap_sys_ptrace=ep ${ffmpegPath}`);
            console.log('[SYSTEM] KMSGrab permissions fixed successfully!');
        } else {
            console.log('[SYSTEM] ffmpeg already has KMSGrab permissions.');
        }
    } catch (error) {
        console.error('[SYSTEM ERROR] Failed to automatically set permissions. Is pkexec installed?');
        console.error(error);
    }
};

/**
 * @returns {string}
 */
const getDrmDevice = () => {
    /** @type {string[]} */
    const paths = ['/dev/dri/card0', '/dev/dri/card1', '/dev/dri/card2'];
    
    for (const p of paths) {
        if (fs.existsSync(p)) {
            console.log(`[SYSTEM] Found DRM device at: ${p}`);
            return p;
        }
    }
    
    console.warn('[SYSTEM WARN] No standard DRM device found. Defaulting to /dev/dri/card0');
    return '/dev/dri/card0';
};

/**
 * @returns {string}
 */
const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');

/**
 * @typedef {Object} AppConfig
 * @property {number} minutes
 * @property {string} sysInput
 * @property {string} micInput
 * @property {boolean} separateAudio
 * @property {string} shortcut
 * @property {string} savePath
 * @property {string} monitorId
 * @property {string} captureMethod
 */

/**
 * @returns {AppConfig}
 */
const getDefaultConfig = () => ({
    minutes: 5,
    sysInput: 'default',
    micInput: 'default',
    separateAudio: true,
    shortcut: 'F10',
    savePath: path.join(os.homedir(), 'Videos'),
    monitorId: '0',
    captureMethod: 'x11grab'
});

/**
 * @returns {AppConfig}
 */
const loadConfig = () => {
    /** @type {string} */
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        /** @type {string} */
        const rawData = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(rawData);
    }
    return getDefaultConfig();
};

/**
 * @param {AppConfig} config
 * @returns {void}
 */
const saveConfig = (config) => {
    /** @type {string} */
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    console.log(`[CONFIG] Settings saved to: ${configPath}`);
};

/**
 * @param {string} dirPath
 * @returns {void}
 */
const ensureDirExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        console.log(`[FILE SYSTEM] Creating directory: ${dirPath}`);
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

/**
 * @param {number} maxMinutes
 * @returns {void}
 */
const startGarbageCollector = (maxMinutes) => {
    if (cleanupInterval) clearInterval(cleanupInterval);
    
    cleanupInterval = setInterval(() => {
        if (!fs.existsSync(TEMP_DIR)) return;
        
        /** @type {string[]} */
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.endsWith('.ts'));
        if (files.length <= maxMinutes) return;
        
        /** @type {Object[]} */
        const fileStats = files.map(f => ({
            name: f,
            time: fs.statSync(path.join(TEMP_DIR, f)).mtime.getTime()
        })).sort((a, b) => a.time - b.time);
        
        /** @type {number} */
        const filesToDelete = fileStats.length - maxMinutes;
        for (let i = 0; i < filesToDelete; i++) {
            /** @type {string} */
            const filePath = path.join(TEMP_DIR, fileStats[i].name);
            try {
                fs.unlinkSync(filePath);
                console.log(`[CLEANUP] Deleted old segment: ${fileStats[i].name}`);
            } catch (e) {
                console.error(`[CLEANUP ERROR] Could not delete ${fileStats[i].name}`);
            }
        }
    }, 15000); 
};

/**
 * @typedef {Object} HardwareInfo
 * @property {Object[]} monitors
 * @property {Object[]} audioDevices
 */

/**
 * @returns {HardwareInfo}
 */
const getHardwareInfo = () => {
    /** @type {Object[]} */
    const monitors = screen.getAllDisplays().map((disp, index) => ({
        id: String(index),
        name: `Monitor ${index + 1} (${disp.bounds.width}x${disp.bounds.height})`,
        bounds: disp.bounds
    }));

    /** @type {Object[]} */
    const audioDevices = [];
    try {
        /** @type {string} */
        const output = execSync('pactl list short sources', { encoding: 'utf-8' });
        /** @type {string[]} */
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
            /** @type {string[]} */
            const parts = line.split('\t');
            if (parts.length >= 2) {
                audioDevices.push({ id: parts[1], name: parts[1] });
            }
        }
    } catch (error) {
        console.error('[SYSTEM] Failed to fetch PulseAudio devices.', error);
        audioDevices.push({ id: 'default', name: 'Default Audio System' });
    }

    return { monitors, audioDevices };
};

/**
 * @param {AppConfig} config
 * @returns {void}
 */
const startRecording = (config) => {
    console.log('[FFMPEG] Initialization requested with config:', config);
    if (ffmpegProcess) {
        console.log('[FFMPEG] Killing previous active process...');
        ffmpegProcess.kill('SIGINT');
    }

    ensureDirExists(TEMP_DIR);
    
    /** @type {string[]} */
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
        try { fs.unlinkSync(path.join(TEMP_DIR, file)); } catch (e) {}
    }

    /** @type {Electron.Display} */
    const display = screen.getAllDisplays()[Number(config.monitorId)] || screen.getPrimaryDisplay();
    
    /** @type {boolean} */
    const isWayland = !!process.env.WAYLAND_DISPLAY;
    if (isWayland) {
        console.warn('[SYSTEM WARN] Wayland detected. Standard x11grab might capture a black screen. Use KMSGrab.');
    }

    /** @type {string[]} */
    let ffmpegArgs = [];

    if (config.captureMethod === 'kmsgrab') {
        ensureKmsgrabPermissions();
        
        /** @type {string} */
        const drmDevice = getDrmDevice();
        
        ffmpegArgs = [
            '-y',
            '-device', drmDevice,
            '-f', 'kmsgrab',
            '-format', 'xrgb8888', // Solves the black screen bug on NVIDIA + KMSGrab
            '-i', '-',
            '-vf', `hwmap=derive_device=cuda,scale_cuda=format=yuv420p`,
            '-framerate', '60'
        ];
    } else {
        ffmpegArgs = [
            '-y',
            '-f', 'x11grab',
            '-video_size', `${display.bounds.width}x${display.bounds.height}`,
            '-framerate', '60',
            '-i', `${process.env.DISPLAY || ':0.0'}+${display.bounds.x},${display.bounds.y}`
        ];
    }

    ffmpegArgs.push('-f', 'pulse', '-i', config.sysInput);

    // Audio mixing logic safely implemented
    if (config.micInput !== 'none') {
        ffmpegArgs.push('-f', 'pulse', '-i', config.micInput);
        
        if (config.separateAudio) {
            console.log('[FFMPEG] Separate audio tracks enabled.');
            ffmpegArgs.push('-map', '0:v', '-map', '1:a', '-map', '2:a');
        } else {
            console.log('[FFMPEG] Merged audio track enabled (amix filter).');
            ffmpegArgs.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest[aout]');
            ffmpegArgs.push('-map', '0:v', '-map', '[aout]');
        }
    } else {
        console.log('[FFMPEG] Single system audio track enabled.');
        ffmpegArgs.push('-map', '0:v', '-map', '1:a');
    }

    ffmpegArgs.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p6',
        '-cq', '19',
        '-b:v', '15M',
        '-c:a', 'aac',
        '-f', 'segment',
        '-segment_time', '60',
        path.join(TEMP_DIR, 'segment_%03d.ts') // Changed to .ts for live stream stability
    );

    console.log('[FFMPEG] Starting with arguments:', ffmpegArgs.join(' '));

    ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { env: process.env });

    ffmpegProcess.stderr.on('data', (data) => {
        /** @type {string} */
        const output = data.toString();
        if (output.includes('error') || output.includes('Error')) {
            console.log(`[FFMPEG LOG] ${output.trim()}`);
        }
    });
    
    ffmpegProcess.on('close', (code) => {
        console.log(`[FFMPEG] Process exited with code ${code}`);
    });
    
    startGarbageCollector(config.minutes);
};

/**
 * @param {string} saveDir
 * @returns {void}
 */
const saveClip = (saveDir) => {
    console.log(`[CLIP] Shortcut triggered! Initiating clip compilation in background...`);
    
    /** @type {Object[]} */
    const fileStats = fs.readdirSync(TEMP_DIR)
        .filter(f => f.endsWith('.ts')) // Targeting .ts
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(TEMP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => a.time - b.time);

    if (fileStats.length === 0) {
        console.warn('[CLIP WARN] No segments available to clip. Is FFmpeg running correctly?');
        return;
    }

    console.log(`[CLIP] Found ${fileStats.length} segments, sorted by modification time.`);

    /** @type {string[]} */
    const files = fileStats.map(f => `file '${path.join(TEMP_DIR, f.name)}'`);

    /** @type {string} */
    const listPath = path.join(TEMP_DIR, 'concat_list.txt');
    fs.writeFileSync(listPath, files.join('\n'));

    /** @type {string} */
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    /** @type {string} */
    let outputPath = path.join(saveDir, `Clip_${timestamp}.mp4`);
    /** @type {number} */
    let counter = 1;

    // Ensure we never overwrite an existing file
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(saveDir, `Clip_${timestamp}_${counter}.mp4`);
        counter++;
    }

    // Pre-create the empty file to ensure the destination is valid and writeable
    try {
        fs.writeFileSync(outputPath, '');
        console.log(`[CLIP] Pre-created empty destination file: ${outputPath}`);
    } catch (err) {
        console.error(`[CLIP ERROR] Failed to create destination file in ${saveDir}. Check permissions!`, err);
        return;
    }

    /** @type {string[]} */
    const concatArgs = [
        '-y', 
        '-f', 'concat', 
        '-safe', '0', 
        '-i', listPath, 
        '-c:v', 'copy', // Copy video stream directly without re-encoding
        '-c:a', 'copy', // Copy audio stream
        outputPath
    ];

    /** @type {import('child_process').ChildProcessWithoutNullStreams} */
    const concatProcess = spawn('ffmpeg', concatArgs);

    concatProcess.stderr.on('data', (data) => {
        /** @type {string} */
        const msg = data.toString().trim();
        if (msg.toLowerCase().includes('error')) {
            console.error(`[CLIP FFmpeg] ${msg}`);
        }
    });

    concatProcess.on('close', (code) => {
        if (code === 0) {
            console.log(`[CLIP SUCCESS] Clip successfully saved at: ${outputPath}`);
        } else {
            console.error(`[CLIP ERROR] Concatenation failed with code: ${code}`);
        }
    });
};

/**
 * @param {AppConfig} config
 * @returns {void}
 */
const applyConfigurationAndStart = (config) => {
    if (!isDirectoryValid(config.savePath)) {
        console.error(`[SYSTEM ERROR] Configured save path is invalid or missing: ${config.savePath}`);
        
        if (ffmpegProcess) {
            ffmpegProcess.kill('SIGINT');
            ffmpegProcess = null;
        }
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
        
        globalShortcut.unregisterAll();
        createConfigWindow();
        dialog.showErrorBox(
            'Invalid Save Directory', 
            'The folder configured to save videos does not exist or is invalid. The recording system has been paused. Please configure a valid folder to resume.'
        );
        return;
    }

    globalShortcut.unregisterAll();
    console.log(`[SHORTCUT] Registering new global shortcut: ${config.shortcut}`);
    
    /** @type {boolean} */
    const isRegistered = globalShortcut.register(config.shortcut, () => {
        saveClip(config.savePath);
    });

    if (!isRegistered) {
        console.error(`[SHORTCUT ERROR] Failed to register shortcut: ${config.shortcut}`);
    } else {
        console.log(`[SHORTCUT SUCCESS] Shortcut ${config.shortcut} registered globally.`);
    }
    
    startRecording(config);
};

/**
 * @returns {void}
 */
const createConfigWindow = () => {
    console.log('[UI] Requesting configuration window...');
    if (configWindow) {
        console.log('[UI] Window already exists, focusing it.');
        configWindow.focus();
        return;
    }

    configWindow = new BrowserWindow({
        width: 650, height: 750, show: false, autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, nodeIntegration: false
        }
    });

    configWindow.loadFile(path.join(__dirname, 'index.html'));
    
    configWindow.once('ready-to-show', () => {
        console.log('[UI] Window ready to show.');
        configWindow.show();
    });
    
    configWindow.on('closed', () => { 
        console.log('[UI] Window closed.');
        configWindow = null; 
    });
};

app.whenReady().then(() => {
    console.log('[TRAY] Setting up system tray...');
    /** @type {string} */
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    try {
        tray = new Tray(iconPath);
        /** @type {Electron.Menu} */
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Settings', click: createConfigWindow },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() }
        ]);

        tray.setToolTip('Pony Clipper');
        tray.setContextMenu(contextMenu);
        tray.on('click', createConfigWindow);
        console.log('[TRAY] Tray setup completed successfully.');
    } catch (error) {
        console.error('[TRAY ERROR] Failed to set up tray icon.', error);
    }

    applyConfigurationAndStart(loadConfig());

    ipcMain.handle('select-folder', async () => {
        console.log('[IPC] Folder selection dialog requested.');
        /** @type {Electron.OpenDialogReturnValue} */
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        if (result.canceled) {
            console.log('[IPC] Folder selection canceled by user.');
            return null;
        }
        console.log(`[IPC] Folder selected: ${result.filePaths[0]}`);
        return result.filePaths[0];
    });

    ipcMain.handle('get-config', () => loadConfig());
    ipcMain.handle('get-hardware', () => getHardwareInfo());

    ipcMain.handle('save-config', (event, config) => {
        if (!isDirectoryValid(config.savePath)) {
            console.error(`[IPC] Validation failed: Attempted to save invalid directory: ${config.savePath}`);
            return false;
        }
        saveConfig(config);
        applyConfigurationAndStart(config);
        return true;
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    console.log('[SYSTEM] Application is quitting. Cleaning up...');
    if (ffmpegProcess) {
        console.log('[SYSTEM] Killing FFmpeg process...');
        ffmpegProcess.kill('SIGKILL');
    }
    if (cleanupInterval) clearInterval(cleanupInterval);
    console.log('[SYSTEM] Cleanup complete. Goodbye!');
});

app.on('window-all-closed', () => {
    console.log('[SYSTEM] All windows closed, but keeping app running in tray.');
});