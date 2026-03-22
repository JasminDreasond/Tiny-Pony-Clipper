import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  dialog,
  Notification,
  session,
  desktopCapturer,
} from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs';

ipcMain.on('console.log', (event, ...args) => console.log(...args));
ipcMain.on('console.error', (event, ...args) => console.error(...args));

// Enable usage of Portal's globalShortcuts. This is essential for cases when
// the app runs in a Wayland session.
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WebRTCPipeWireCapturer');

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

/** @type {BrowserWindow | null} */
let configWindow = null;

/** @type {BrowserWindow | null} */
let captureWindow = null;

/** @type {Tray | null} */
let tray = null;

/** @type {NodeJS.Timeout | null} */
let cleanupInterval = null;

/** @type {boolean} */
let isClipping = false;

// --- HARDWARE DEBOUNCE (Fixes Electron infinite loop bug) ---
/** @type {boolean} */
let isHardwareDebouncing = false;

// --- RATE LIMIT VARIABLES ---
/** @type {number} */
const RATE_LIMIT_TRIGGER_MS = 300;
/** @type {number} */
const RATE_LIMIT_COOLDOWN_MS = 1000;
/** @type {number} */
let lastShortcutTime = 0;
/** @type {boolean} */
let isRateLimited = false;

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
 */

/**
 * @returns {AppConfig}
 */
const getDefaultConfig = () => ({
  minutes: 5,
  sysInput: 'default',
  micInput: 'none',
  separateAudio: false,
  shortcut: 'F10',
  savePath: path.join(os.homedir(), 'Videos'),
  monitorId: '0',
});

/**
 * @returns {AppConfig}
 */
const loadConfig = () => {
  /** @type {string} */
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
    if (isClipping) {
      console.log('[CLEANUP] Cleanup paused because a clip is currently being processed.');
      return;
    }

    if (!fs.existsSync(TEMP_DIR)) return;

    /** @type {string[]} */
    const files = fs.readdirSync(TEMP_DIR).filter((f) => f.endsWith('.webm'));
    if (files.length <= maxMinutes) return;

    /** @type {Object[]} */
    const fileStats = files
      .map((f) => ({ name: f, time: fs.statSync(path.join(TEMP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => a.time - b.time);

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
 * @returns {Object}
 */
const getHardwareInfo = () => {
  /** @type {Object[]} */
  const monitors = screen.getAllDisplays().map((disp, index) => ({
    id: String(index),
    name: `Monitor ${index + 1} (${disp.bounds.width}x${disp.bounds.height})`,
    bounds: disp.bounds,
  }));
  return { monitors };
};

/**
 * Starts the FFmpeg recording process based on the provided configuration.
 * @param {AppConfig} config
 * @returns {void}
 */
const startRecording = (config) => {
  console.log('[SYSTEM] Waking up capture engine...');

  // Notify the capture window to stop any current stream capture
  if (captureWindow) {
    captureWindow.webContents.send('capture-command', { action: 'stop' });
  }

  // Ensure the temporary directory exists before starting operations
  ensureDirExists(TEMP_DIR);

  // Clean up the temporary directory by removing all previous segments
  /** @type {string[]} */
  const files = fs.readdirSync(TEMP_DIR);
  for (const file of files) {
    try {
      // Synchronously delete each file in the temp folder
      fs.unlinkSync(path.join(TEMP_DIR, file));
    } catch (e) {
      console.error(e);
      // Ignore errors if a file cannot be deleted (e.g., locked by another process)
    }
  }

  // Determine the target display using the provided ID or fallback to the primary one
  /** @type {Electron.Display} */
  const display = screen.getAllDisplays()[Number(config.monitorId)] || screen.getPrimaryDisplay();

  // Instruct the renderer process to start sending the video stream with specific bounds
  captureWindow.webContents.send('capture-command', {
    action: 'start',
    config: config,
    /** @type {Electron.Rectangle} */
    bounds: display.bounds,
  });

  startGarbageCollector(config.minutes);
};

/**
 * @param {string} saveDir
 * @returns {void}
 */
const saveClip = (saveDir) => {
  if (isClipping) return;
  console.log(`[CLIP] Shortcut triggered! Engaging FFmpeg hardware transcoding...`);
  isClipping = true;

  /** @type {Object[]} */
  const fileStats = fs
    .readdirSync(TEMP_DIR)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(TEMP_DIR, f)).mtime.getTime() }))
    .sort((a, b) => a.time - b.time);

  if (fileStats.length === 0) {
    console.warn('[CLIP WARN] No segments available to clip.');
    isClipping = false;
    return;
  }

  console.log(`[CLIP] Joining ${fileStats.length} segments.`);

  /** @type {string[]} */
  const files = fileStats.map((f) => `file '${path.join(TEMP_DIR, f.name)}'`);
  /** @type {string} */
  const listPath = path.join(TEMP_DIR, 'concat_list.txt');
  fs.writeFileSync(listPath, files.join('\n'));

  /** @type {string} */
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  /** @type {string} */
  let outputPath = path.join(saveDir, `Clip_${timestamp}.mp4`);
  /** @type {number} */
  let counter = 1;

  while (fs.existsSync(outputPath)) {
    outputPath = path.join(saveDir, `Clip_${timestamp}_${counter}.mp4`);
    counter++;
  }

  // Pre-create the empty file to ensure the destination is valid and writeable
  try {
    fs.writeFileSync(outputPath, '');
  } catch (err) {
    console.error(
      `[CLIP ERROR] Failed to create destination file in ${saveDir}. Check permissions!`,
      err,
    );
    isClipping = false;
    return;
  }

  // Uses hardware NVENC transcoding to rebuild timestamps starting from 0 perfectly
  /** @type {string[]} */
  const concatArgs = [
    '-y',
    '-fflags',
    '+genpts',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p6',
    '-cq',
    '19',
    '-c:a',
    'aac',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
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
    isClipping = false;
    if (code === 0) console.log(`[CLIP SUCCESS] MP4 Assembly complete: ${outputPath}`);
    else console.error(`[CLIP ERROR] Assembly failed with code: ${code}`);
  });

  concatProcess.on('error', (err) => {
    isClipping = false;
    console.error(`[CLIP ERROR] Failed to spawn FFmpeg process:`, err);
  });
};

/**
 * @param {AppConfig} config
 * @returns {void}
 */
const applyConfigurationAndStart = (config) => {
  if (!isDirectoryValid(config.savePath)) {
    console.error(`[SYSTEM ERROR] Configured save path is invalid or missing: ${config.savePath}`);
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    if (captureWindow) captureWindow.webContents.send('capture-command', { action: 'stop' });

    globalShortcut.unregisterAll();
    createConfigWindow();
    dialog.showErrorBox(
      'Invalid Save Directory',
      'The folder configured to save videos does not exist or is invalid.',
    );
    return;
  }

  globalShortcut.unregisterAll();
  console.log(`[SHORTCUT] Registering new global shortcut: ${config.shortcut}`);

  /** @type {boolean} */
  const isRegistered = globalShortcut.register(config.shortcut, () => {
    // --- HARDWARE DEBOUNCE SHIELD ---
    // If Electron triggers a ghost event storm, this drops them immediately.
    if (isHardwareDebouncing) return;
    isHardwareDebouncing = true;
    setTimeout(() => {
      isHardwareDebouncing = false;
    }, 500);

    /** @type {number} */
    const now = Date.now();
    /** @type {number} */
    const timeDiff = now - lastShortcutTime;
    lastShortcutTime = now;

    if (isRateLimited) {
      if (timeDiff < RATE_LIMIT_COOLDOWN_MS) return;
      isRateLimited = false;
    }

    if (timeDiff < RATE_LIMIT_TRIGGER_MS) {
      isRateLimited = true;
      new Notification({ title: 'Rate Limit', body: 'Please wait 10 seconds.' }).show();
      return;
    }

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
 * @returns {Promise<void>}
 */
const createHiddenCaptureWindow = async () => {
  captureWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await captureWindow.loadFile(path.join(__dirname, 'capture.html'));
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
    width: 650,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

app.whenReady().then(async () => {
  // --- WAYLAND PORTAL HANDLER ---
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          if (sources && sources.length > 0) {
            callback({ video: sources[0] });
          } else {
            console.warn('[SYSTEM WARN] Portal canceled by user.');
            callback(null);
          }
        })
        .catch((err) => {
          console.error('[SYSTEM ERROR] Failed to fetch desktop sources:', err);
          callback(null);
        });
    },
    { useSystemPicker: true },
  );

  /** @type {string} */
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Tiny Pony Clipper');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Settings', click: createConfigWindow },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
    tray.on('click', createConfigWindow);
    console.log('[TRAY] Tray setup completed successfully.');
  } catch (error) {
    console.error('[TRAY ERROR] Failed to set up tray icon.', error);
  }

  await createHiddenCaptureWindow();

  ipcMain.on('video-chunk', (event, payload) => {
    /** @type {ArrayBuffer} */
    const buffer = payload.buffer;
    /** @type {number} */
    const segmentIndex = payload.segmentIndex;

    /** @type {string} */
    const fileName = `segment_${String(segmentIndex).padStart(3, '0')}.webm`;
    /** @type {string} */
    const filePath = path.join(TEMP_DIR, fileName);

    try {
      fs.appendFileSync(filePath, Buffer.from(buffer));
    } catch (e) {
      console.error(`[FS ERROR] Failed to write chunk to ${fileName}`, e);
    }
  });

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
      console.error(
        `[IPC] Validation failed: Attempted to save invalid directory: ${config.savePath}`,
      );
      return false;
    }
    saveConfig(config);
    applyConfigurationAndStart(config);
    return true;
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[SYSTEM] Application is quitting.');
  if (cleanupInterval) clearInterval(cleanupInterval);
});

app.on('window-all-closed', () => {
  console.log('[SYSTEM] All windows closed, but keeping app running in tray.');
});
