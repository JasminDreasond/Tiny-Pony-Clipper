import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, dialog } from 'electron';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import os from 'os';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {BrowserWindow | null} */
let configWindow = null;

/** @type {Tray | null} */
let tray = null;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let ffmpegProcess = null;

const TEMP_DIR = path.join(os.tmpdir(), 'pony_clipper_segments');
const DEFAULT_SAVE_DIR = path.join(os.homedir(), 'Videos');

/**
 * @param {string} dirPath
 */
const ensureDirExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        console.log(`[FILE SYSTEM] Creating directory: ${dirPath}`);
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

/**
 * @param {string} tempDir
 */
const clearSegments = (tempDir) => {
    console.log(`[FILE SYSTEM] Clearing old segments in: ${tempDir}`);
    ensureDirExists(tempDir);
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
    }
    console.log(`[FILE SYSTEM] Segments cleared. Total files removed: ${files.length}`);
};

/**
 * @returns {number[]}
 */
const getScreenResolution = () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    console.log(`[SYSTEM] Detected screen resolution: ${primaryDisplay.bounds.width}x${primaryDisplay.bounds.height}`);
    return [primaryDisplay.bounds.width, primaryDisplay.bounds.height];
};

/**
 * @param {Object} config
 * @param {number} config.minutes
 * @param {string} config.micInput
 * @param {string} config.sysInput
 * @param {boolean} config.separateAudio
 */
const startRecording = (config) => {
    console.log('[FFMPEG] Initialization requested with config:', config);

    if (ffmpegProcess) {
        console.log('[FFMPEG] Killing previous active process...');
        ffmpegProcess.kill('SIGINT');
    }

    clearSegments(TEMP_DIR);
    const [width, height] = getScreenResolution();

    const ffmpegArgs = [
        '-y',
        '-f', 'x11grab',
        '-video_size', `${width}x${height}`,
        '-framerate', '60',
        '-i', ':0.0', 
        '-f', 'pulse',
        '-i', config.sysInput,
    ];

    if (config.separateAudio && config.micInput) {
        console.log('[FFMPEG] Separate audio track enabled.');
        ffmpegArgs.push('-f', 'pulse', '-i', config.micInput);
        ffmpegArgs.push('-map', '0:v', '-map', '1:a', '-map', '2:a');
    }

    ffmpegArgs.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p6',
        '-cq', '19',
        '-b:v', '15M',
        '-c:a', 'aac',
        '-f', 'segment',
        '-segment_time', '60',
        '-segment_wrap', String(config.minutes),
        path.join(TEMP_DIR, 'segment_%03d.mp4')
    );

    console.log('[FFMPEG] Spawning process with arguments:', ffmpegArgs.join(' '));
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        // FFmpeg writes normal logs to stderr, so we log it as standard info unless it's a real error.
        console.log(`[FFMPEG LOG] ${output}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[FFMPEG] Process exited with code ${code}`);
    });

    ffmpegProcess.on('error', (err) => {
        console.error(`[FFMPEG ERROR] Failed to start process:`, err);
    });
};

/**
 * @param {string} saveDir
 */
const saveClip = (saveDir) => {
    console.log(`[CLIP] Shortcut triggered! Initiating clip compilation...`);
    
    const files = fs.readdirSync(TEMP_DIR)
        .filter(f => f.endsWith('.mp4'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(TEMP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => a.time - b.time)
        .map(f => `file '${path.join(TEMP_DIR, f.name)}'`);

    if (files.length === 0) {
        console.warn('[CLIP WARN] No segments available to clip. Is FFmpeg running correctly?');
        return;
    }

    console.log(`[CLIP] Found ${files.length} segments to concatenate.`);

    const listPath = path.join(TEMP_DIR, 'concat_list.txt');
    fs.writeFileSync(listPath, files.join('\n'));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(saveDir, `Clip_${timestamp}.mp4`);

    const concatArgs = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        outputPath
    ];

    console.log(`[CLIP] Executing concatenation...`);
    try {
        execSync(`ffmpeg ${concatArgs.join(' ')}`);
        console.log(`[CLIP SUCCESS] Clip successfully saved at: ${outputPath}`);
    } catch (error) {
        console.error(`[CLIP ERROR] Failed to concatenate segments:`, error);
    }
};

const createConfigWindow = () => {
    console.log('[UI] Requesting configuration window...');
    if (configWindow) {
        console.log('[UI] Window already exists, focusing it.');
        configWindow.focus();
        return;
    }

    configWindow = new BrowserWindow({
        width: 600,
        height: 700,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
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

const setupTray = () => {
    console.log('[TRAY] Setting up system tray...');
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    
    try {
        tray = new Tray(iconPath);
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
        console.error('[TRAY ERROR] Failed to set up tray icon. Make sure assets/tray-icon.png exists!', error);
    }
};

app.whenReady().then(() => {
    console.log('[SYSTEM] Electron App is ready.');
    setupTray();

    ipcMain.handle('select-folder', async () => {
        console.log('[IPC] Folder selection dialog requested.');
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        if (result.canceled) {
            console.log('[IPC] Folder selection canceled by user.');
            return null;
        }
        console.log(`[IPC] Folder selected: ${result.filePaths[0]}`);
        return result.filePaths[0];
    });

    ipcMain.handle('get-default-path', () => {
        console.log(`[IPC] Sending default path to UI: ${DEFAULT_SAVE_DIR}`);
        return DEFAULT_SAVE_DIR;
    });

    ipcMain.on('apply-settings', (event, config) => {
        console.log('[IPC] Received new settings from UI:', config);
        
        globalShortcut.unregisterAll();
        console.log(`[SHORTCUT] Registering new global shortcut: ${config.shortcut}`);
        
        const isRegistered = globalShortcut.register(config.shortcut, () => {
            saveClip(config.savePath);
        });

        if (!isRegistered) {
            console.error(`[SHORTCUT ERROR] Failed to register shortcut: ${config.shortcut}`);
        } else {
            console.log(`[SHORTCUT SUCCESS] Shortcut ${config.shortcut} registered globally.`);
        }
        
        startRecording(config);
    });
});

app.on('will-quit', () => {
    console.log('[SYSTEM] Application is quitting. Cleaning up...');
    globalShortcut.unregisterAll();
    if (ffmpegProcess) {
        console.log('[SYSTEM] Killing FFmpeg process...');
        ffmpegProcess.kill('SIGKILL');
    }
    clearSegments(TEMP_DIR);
    console.log('[SYSTEM] Cleanup complete. Goodbye!');
});

app.on('window-all-closed', () => {
    console.log('[SYSTEM] All windows closed, but keeping app running in tray.');
});