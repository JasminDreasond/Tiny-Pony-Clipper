import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  dialog,
  session,
  desktopCapturer,
  shell,
} from 'electron';
import { spawn, execSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { sendNotification } from './utils/Notification.js';
import { appIconPath, assetsFolder, srcFolder } from './utils/values.js';

ipcMain.on('console.log', (event, ...args) => console.log(...args));
ipcMain.on('console.error', (event, ...args) => console.error(...args));

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WebRTCPipeWireCapturer');
app.setAppUserModelId('TinyPonyClipper');

/** @type {boolean} */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (configWindow) {
      if (configWindow.isMinimized()) configWindow.restore();
      configWindow.focus();
    } else {
      createConfigWindow();
    }
  });
}

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

/** @type {number} */
let activeSegmentTimestamp = 0;

const clipSound = path.join(assetsFolder, './sounds/clip-saved.mp3');
const saveSound = path.join(assetsFolder, './sounds/saving-clip.mp3');
const failSound = path.join(assetsFolder, './sounds/clip-fail.mp3');

// --- RATE LIMIT VARIABLES ---
/** @type {number} */
const RATE_LIMIT_TRIGGER_MS = 300;
/** @type {number} */
const RATE_LIMIT_COOLDOWN_MS = 1000;
/** @type {number} */
let lastShortcutTime = 0;
/** @type {boolean} */
let isRateLimited = false;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let audioProcess = null;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let concatProcess;

/** @type {AppConfig | null} */
let currentConfig = null;

/** @type {string} */
const TEMP_DIR = path.join(os.tmpdir(), 'pony_clipper_segments');

/**
 * @returns {{ monitors: Object[], audioDevices: Object[] }}
 */
const getHardwareInfo = () => {
  /** @type {Object[]} */
  const monitors = screen.getAllDisplays().map((disp, index) => ({
    id: String(index),
    name: `Monitor ${index + 1} (${disp.bounds.width}x${disp.bounds.height})`,
    bounds: disp.bounds,
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
    if (isClipping) return;
    if (!fs.existsSync(TEMP_DIR)) return;

    /** @type {string[]} */
    const files = fs
      .readdirSync(TEMP_DIR)
      .filter((f) => f.startsWith('video_') && f.endsWith('.webm'));
    if (files.length <= maxMinutes) return;

    /** @type {Object[]} */
    const segments = files
      .map((f) => {
        /** @type {string} */
        const ts = f.replace('video_', '').replace('.webm', '');
        return { timestamp: ts, time: parseInt(ts, 10) };
      })
      .sort((a, b) => a.time - b.time);

    /** @type {number} */
    const filesToDelete = segments.length - maxMinutes;
    for (let i = 0; i < filesToDelete; i++) {
      if (segments[i].time === activeSegmentTimestamp) continue;

      /** @type {string} */
      const ts = segments[i].timestamp;
      try {
        if (fs.existsSync(path.join(TEMP_DIR, `video_${ts}.webm`)))
          fs.unlinkSync(path.join(TEMP_DIR, `video_${ts}.webm`));
        if (fs.existsSync(path.join(TEMP_DIR, `sys_${ts}.wav`)))
          fs.unlinkSync(path.join(TEMP_DIR, `sys_${ts}.wav`));
        if (fs.existsSync(path.join(TEMP_DIR, `mic_${ts}.wav`)))
          fs.unlinkSync(path.join(TEMP_DIR, `mic_${ts}.wav`));
        console.log(`[CLEANUP] Deleted old segment blocks for: ${ts}`);
      } catch (e) {
        console.error(`[CLEANUP ERROR] Could not delete cache for ${ts}`);
      }
    }
  }, 15000);
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

  if (audioProcess) {
    audioProcess.stdin.write('q\n');
    audioProcess = null;
  }

  currentConfig = config;

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

  // Instruct the renderer process to start sending the video stream
  captureWindow.webContents.send('capture-command', { action: 'start' });
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

  sendNotification(
    {
      title: 'Tiny Pony Clipper',
      urgency: 'normal',
      body: 'Processing your clip... Please wait a moment.',
    },
    saveSound,
  );

  if (!currentConfig) {
    isClipping = false;
    return;
  }

  /** @type {string[]} */
  const videoFiles = fs
    .readdirSync(TEMP_DIR)
    .filter((f) => f.startsWith('video_') && f.endsWith('.webm'));

  if (videoFiles.length === 0) {
    console.warn('[CLIP WARN] No segments available to clip.');
    sendNotification(
      {
        title: 'Clipping Failed',
        urgency: 'critical',
        body: 'No recorded segments available yet. Please wait a bit longer.',
      },
      failSound,
    );
    isClipping = false;
    return;
  }

  /** @type {Object[]} */
  const segments = videoFiles
    .map((f) => {
      /** @type {string} */
      const ts = f.replace('video_', '').replace('.webm', '');
      return { timestamp: ts, time: parseInt(ts, 10) };
    })
    .sort((a, b) => a.time - b.time);

  /** @type {string[]} */
  const listVideo = [];
  /** @type {string[]} */
  const listSys = [];
  /** @type {string[]} */
  const listMic = [];

  for (const seg of segments) {
    listVideo.push(`file '${path.join(TEMP_DIR, `video_${seg.timestamp}.webm`)}'`);
    listSys.push(`file '${path.join(TEMP_DIR, `sys_${seg.timestamp}.wav`)}'`);
    if (currentConfig.micInput !== 'none') {
      listMic.push(`file '${path.join(TEMP_DIR, `mic_${seg.timestamp}.wav`)}'`);
    }
  }

  /** @type {string} */
  const listVideoPath = path.join(TEMP_DIR, 'concat_video.txt');
  /** @type {string} */
  const listSysPath = path.join(TEMP_DIR, 'concat_sys.txt');
  /** @type {string} */
  const listMicPath = path.join(TEMP_DIR, 'concat_mic.txt');

  fs.writeFileSync(listVideoPath, listVideo.join('\n'));
  fs.writeFileSync(listSysPath, listSys.join('\n'));
  if (currentConfig.micInput !== 'none') {
    fs.writeFileSync(listMicPath, listMic.join('\n'));
  }

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

  /** @type {string[]} */
  const ffmpegArgs = [
    '-y',
    '-fflags',
    '+genpts',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listVideoPath,
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listSysPath,
  ];

  // Your requested audio mixing logic safely implemented for assembly!
  if (currentConfig.micInput !== 'none') {
    ffmpegArgs.push('-f', 'concat', '-safe', '0', '-i', listMicPath);

    if (currentConfig.separateAudio) {
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
  );

  /** @type {import('child_process').ChildProcessWithoutNullStreams} */
  concatProcess = spawn('ffmpeg', ffmpegArgs, { env: process.env });

  concatProcess.stderr.on('data', (data) => {
    /** @type {string} */
    const msg = data.toString().trim();
    if (msg.toLowerCase().includes('error')) {
      console.error(`[CLIP FFmpeg] ${msg}`);
    }
  });

  concatProcess.on('close', (code) => {
    isClipping = false;
    concatProcess.stdin.write('q\n');
    concatProcess = null;

    if (code === 0) {
      console.log(`[CLIP SUCCESS] MP4 Assembly complete: ${outputPath}`);
      sendNotification(
        {
          title: 'Clip Saved!',
          urgency: 'critical',
          body: `Successfully saved: ${path.basename(outputPath)}\nClick here to view.`,
        },
        clipSound,
        () => {
          shell.showItemInFolder(outputPath);
        },
      );

      console.log('[CLIP] Resetting segment buffer to prevent overlap...');
      for (const seg of segments) {
        if (seg.time === activeSegmentTimestamp) {
          console.log(`[CLIP] Keeping active segment protected: ${seg.timestamp}`);
          continue;
        }

        /** @type {string} */
        const vPath = path.join(TEMP_DIR, `video_${seg.timestamp}.webm`);
        /** @type {string} */
        const sPath = path.join(TEMP_DIR, `sys_${seg.timestamp}.wav`);
        /** @type {string} */
        const mPath = path.join(TEMP_DIR, `mic_${seg.timestamp}.wav`);

        try {
          if (fs.existsSync(vPath)) fs.unlinkSync(vPath);
          if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
          if (fs.existsSync(mPath)) fs.unlinkSync(mPath);
        } catch (e) {
          console.error(`[FS ERROR] Could not delete segment ${seg.timestamp}:`, e);
        }
      }

      try {
        if (fs.existsSync(listVideoPath)) fs.unlinkSync(listVideoPath);
        if (fs.existsSync(listSysPath)) fs.unlinkSync(listSysPath);
        if (fs.existsSync(listMicPath)) fs.unlinkSync(listMicPath);
      } catch (e) {
        console.error(e);
      }
    } else {
      console.error(`[CLIP ERROR] Assembly failed with code: ${code}`);
      sendNotification(
        {
          title: 'Clipping Error',
          urgency: 'critical',
          body: `Failed to save clip. FFmpeg exited with code ${code}.`,
        },
        failSound,
      );
    }
  });

  concatProcess.on('error', (err) => {
    isClipping = false;
    concatProcess.stdin.write('q\n');
    concatProcess = null;
    console.error(`[CLIP ERROR] Failed to spawn FFmpeg process:`, err);
    sendNotification(
      {
        title: 'System Error',
        urgency: 'critical',
        body: 'Could not start the video processing engine.',
      },
      failSound,
    );
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
      sendNotification(
        {
          title: 'Rate Limit',
          body: 'Please wait 10 seconds.',
          urgency: 'critical',
        },
        failSound,
      );
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

  sendNotification({
    title: 'Tiny Pony Clipper',
    urgency: 'normal',
    body: `Engine is active! Press ${config.shortcut} to save a clip.`,
  });
};

/**
 * @returns {Promise<void>}
 */
const createHiddenCaptureWindow = async () => {
  captureWindow = new BrowserWindow({
    show: false,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(srcFolder, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await captureWindow.loadFile(path.join(srcFolder, 'capture.html'));
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
    icon: appIconPath,
    webPreferences: {
      preload: path.join(srcFolder, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  configWindow.loadFile(path.join(srcFolder, 'index.html'));
  configWindow.once('ready-to-show', () => {
    console.log('[UI] Window ready to show.');
    configWindow.show();
  });
  configWindow.on('closed', () => {
    console.log('[UI] Window closed.');
    configWindow = null;
  });
};

if (gotTheLock) {
  app.whenReady().then(async () => {
    // --- WAYLAND PORTAL HANDLER ---
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen', 'window'], fetchWindowIcons: true })
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

    try {
      tray = new Tray(appIconPath);
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

    /**
     * @param {Electron.IpcMainEvent} event
     * @param {string} timestamp
     * @returns {void}
     */
    ipcMain.on('start-segment', (event, timestamp) => {
      activeSegmentTimestamp = Number(timestamp);

      if (audioProcess) {
        audioProcess.stdin.write('q\n');
        audioProcess = null;
      }

      if (!currentConfig) return;

      /** @type {string} */
      let sysDevice = currentConfig.sysInput;

      // PulseAudio logic: 'default' points to the mic. We need the monitor for desktop audio.
      if (sysDevice === 'default') {
        sysDevice = 'default.monitor';
      }

      /** @type {string[]} */
      const audioArgs = ['-y', '-f', 'pulse', '-i', sysDevice];

      if (currentConfig.micInput !== 'none') {
        /** @type {string} */
        let micDevice = currentConfig.micInput;

        audioArgs.push('-f', 'pulse', '-i', micDevice);
        audioArgs.push('-map', '0:a', path.join(TEMP_DIR, `sys_${timestamp}.wav`));
        audioArgs.push('-map', '1:a', path.join(TEMP_DIR, `mic_${timestamp}.wav`));
      } else {
        audioArgs.push('-map', '0:a', path.join(TEMP_DIR, `sys_${timestamp}.wav`));
      }

      console.log(`[SYSTEM] ffmpeg`, audioArgs.join(' '));
      audioProcess = spawn('ffmpeg', audioArgs, { env: process.env });
    });

    ipcMain.on('video-chunk', (event, payload) => {
      /** @type {ArrayBuffer} */
      const buffer = payload.buffer;
      /** @type {number} */
      const timestamp = payload.timestamp;

      /** @type {string} */
      const fileName = `video_${timestamp}.webm`;
      /** @type {string} */
      const filePath = path.join(TEMP_DIR, fileName);

      try {
        fs.appendFileSync(filePath, Buffer.from(buffer));
      } catch (e) {
        console.error(`[FS ERROR] Failed to write chunk to ${fileName}`, e);
      }
    });

    applyConfigurationAndStart(loadConfig());

    ipcMain.handle('is-wayland', () => {
      /** @type {boolean} */
      const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
      return isWayland;
    });

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

      console.log('[SYSTEM] Relaunching application to apply new configuration...');
      app.relaunch();
      app.quit();

      return true;
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    console.log('[SYSTEM] Application is quitting.');

    if (audioProcess) {
      console.log('[SYSTEM] Killing audio process...');
      audioProcess.kill('SIGKILL');
    }

    if (concatProcess) {
      console.log('[SYSTEM] Killing concat process...');
      concatProcess.kill('SIGKILL');
    }

    if (cleanupInterval) clearInterval(cleanupInterval);
  });
}
