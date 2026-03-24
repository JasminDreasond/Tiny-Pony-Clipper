import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  dialog,
  session,
  desktopCapturer,
  shell,
} from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { sendNotification } from './utils/Notification.js';
import {
  appIconPath,
  srcFolder,
  getHardwareInfo,
  appIconProcessingPath,
  windowsCache,
} from './utils/values.js';

import { canAccessUinput, destroyAllGamepads, updateGamepadState } from './utils/VirtualGamepad.js';
import { startStreamServer, sendSignalToClient } from './utils/StreamServer.js';

ipcMain.on('console.log', (event, ...args) => console.log(...args));
ipcMain.on('console.error', (event, ...args) => console.error(...args));
ipcMain.on('open-external', (event, url) => shell.openExternal(url));

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WebRTCPipeWireCapturer');
app.setAppUserModelId('TinyPonyClipper');

/** @type {boolean} */
const isWaylandEnv = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

/** @type {boolean} */
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (windowsCache.configWindow) {
      if (windowsCache.configWindow.isMinimized()) windowsCache.configWindow.restore();
      if (!windowsCache.configWindow.isVisible()) windowsCache.configWindow.show();
      windowsCache.configWindow.focus();
    } else {
      createConfigWindow();
    }
  });
}

/** @type {Tray | null} */
let tray = null;

/** @type {NodeJS.Timeout | null} */
let cleanupInterval = null;

// --- HARDWARE DEBOUNCE (Fixes Electron infinite loop bug) ---
/** @type {boolean} */
let isHardwareDebouncing = false;

/** @type {number} */
let activeSegmentTimestamp = 0;

/** @type {number} */
let clipsProcessingCount = 0;

/** @type {Set<import('child_process').ChildProcessWithoutNullStreams>} */
const activeConcatProcesses = new Set();

/** @type {Set<number>} */
const warnedPads = new Set();

const clipSound = path.join(srcFolder, './sounds/clip-saved.mp3');
const saveSound = path.join(srcFolder, './sounds/saving-clip.mp3');
const failSound = path.join(srcFolder, './sounds/clip-fail.mp3');

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

/** @type {AppConfig | null} */
let currentConfig = null;

/** @type {string} */
const TEMP_DIR = path.join(os.tmpdir(), 'pony_clipper_segments');

/** @type {string} */
const JOBS_DIR = path.join(os.tmpdir(), 'pony_clipper_jobs');

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
 * @property {boolean} enableClipping
 * @property {number} minutes
 * @property {string} sysInput
 * @property {string} micInput
 * @property {boolean} separateAudio
 * @property {string} shortcut
 * @property {string} savePath
 * @property {string} videoCodec
 * @property {string} videoPreset
 * @property {string} videoQualityCmd
 * @property {string} videoQualityValue
 * @property {string} audioCodec
 * @property {boolean} streamEnabled
 * @property {number} streamPort
 * @property {string} streamPassword
 * @property {string} gamepadType
 * @property {number} maxGamepads
 * @property {string} iceServers
 * @property {number} frameRate
 */

// Update your default config function
/**
 * @returns {AppConfig}
 */
const getDefaultConfig = () => ({
  enableClipping: true,
  minutes: 5,
  sysInput: 'default',
  micInput: 'none',
  separateAudio: false,
  shortcut: 'F10',
  savePath: path.join(os.homedir(), 'Videos'),
  videoCodec: 'h264_nvenc',
  videoPreset: 'p6',
  videoQualityCmd: '-cq',
  videoQualityValue: '19',
  audioCodec: 'aac',
  frameRate: 60,
  // Stream Settings
  streamEnabled: false,
  streamPort: 8080,
  streamPassword: 'pony',
  gamepadType: 'xbox',
  maxGamepads: 12,
  iceServers: 'stun:stun.l.google.com:19302',
});

/**
 * @returns {AppConfig}
 */
const loadConfig = () => {
  const defaultCfg = getDefaultConfig();

  /** @type {string} */
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    let userCfg;
    try {
      userCfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error(e);
      userCfg = {};
    }
    return { ...defaultCfg, ...userCfg };
  }
  return defaultCfg;
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
    const files = fs.readdirSync(TEMP_DIR);
    /** @type {Set<number>} */
    const timestamps = new Set();

    /**
     * @param {string} file
     * @returns {{ match: number; isValid: boolean }}
     */
    const isMatch = (file) => {
      const match = parseInt(path.parse(file).name.split('_')[1]);
      return {
        match,
        isValid:
          typeof match === 'number' &&
          Number.isInteger(match) &&
          !Number.isNaN(match) &&
          Number.isFinite(match),
      };
    };

    // Regex to find timestamps in filenames (e.g., _1700000000000.)
    for (const file of files) {
      const { match, isValid } = isMatch(file);
      if (isValid) timestamps.add(match);
    }

    /** @type {number[]} */
    const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);
    /** @type {Set<number>} */
    const timestampsToKeep = new Set();

    // Always protect the segment that is currently being recorded
    timestampsToKeep.add(activeSegmentTimestamp);

    // Keep the most recent timestamps up to the configured buffer limit
    /** @type {number[]} */
    const recent = sortedTimestamps.slice(-maxMinutes);
    for (const ts of recent) timestampsToKeep.add(ts);

    // Destroy any file that is not protected
    for (const file of files) {
      // Clean up orphaned ffmpeg text lists if we are not actively clipping
      if (file.endsWith('.txt')) {
        try {
          fs.unlinkSync(path.join(TEMP_DIR, file));
        } catch (e) {
          console.error(e);
        }
        continue;
      }

      const { match: fileTs, isValid } = isMatch(file);
      if (isValid) {
        if (!timestampsToKeep.has(fileTs)) {
          try {
            fs.unlinkSync(path.join(TEMP_DIR, file));
            console.log(`[CLEANUP] Deleted old cache file: ${file}`);
          } catch (e) {
            console.error(`[CLEANUP ERROR] Could not delete ${file}`, e);
          }
        }
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
  if (windowsCache.captureWindow) {
    windowsCache.captureWindow.webContents.send('capture-command', { action: 'stop' });
  }

  if (audioProcess) {
    audioProcess.stdin.write('q\n');
    audioProcess = null;
  }

  currentConfig = config;

  // Ensure the temporary directory exists before starting operations
  ensureDirExists(TEMP_DIR);
  ensureDirExists(JOBS_DIR);

  try {
    const jobDirs = fs.readdirSync(JOBS_DIR);
    for (const dir of jobDirs) {
      fs.rmSync(path.join(JOBS_DIR, dir), { recursive: true, force: true });
    }
  } catch (e) {
    console.error('[SYSTEM] Could not clean previous jobs directory:', e);
  }

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
  windowsCache.captureWindow.webContents.send('capture-command', {
    action: 'start',
    streamEnabled: config.streamEnabled,
    frameRate: config.frameRate,
  });
  startGarbageCollector(config.minutes);
};

/**
 * @param {string} saveDir
 * @returns {void}
 */
const saveClip = (saveDir) => {
  if (!currentConfig) return;

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
    return;
  }

  clipsProcessingCount++;
  if (tray) tray.setImage(appIconProcessingPath);

  sendNotification(
    {
      title: 'Tiny Pony Clipper',
      urgency: 'normal',
      body: `Processing your clip... (${clipsProcessingCount} in queue)`,
      icon: appIconProcessingPath,
    },
    saveSound,
  );

  /** @type {string} */
  const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  console.log(`[CLIP] Shortcut triggered! Engaging FFmpeg hardware transcoding for ${jobId}...`);

  /** @type {string} */
  const jobDir = path.join(JOBS_DIR, jobId);

  ensureDirExists(jobDir);

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
    /** @type {string} */
    const vFile = `video_${seg.timestamp}.webm`;
    /** @type {string} */
    const sFile = `sys_${seg.timestamp}.wav`;
    /** @type {string} */
    const mFile = `mic_${seg.timestamp}.wav`;

    try {
      if (fs.existsSync(path.join(TEMP_DIR, vFile))) {
        fs.copyFileSync(path.join(TEMP_DIR, vFile), path.join(jobDir, vFile));
        listVideo.push(`file '${path.join(jobDir, vFile)}'`);
      }

      if (fs.existsSync(path.join(TEMP_DIR, sFile))) {
        fs.copyFileSync(path.join(TEMP_DIR, sFile), path.join(jobDir, sFile));
        listSys.push(`file '${path.join(jobDir, sFile)}'`);
      }

      if (currentConfig.micInput !== 'none') {
        if (fs.existsSync(path.join(TEMP_DIR, mFile))) {
          fs.copyFileSync(path.join(TEMP_DIR, mFile), path.join(jobDir, mFile));
          listMic.push(`file '${path.join(jobDir, mFile)}'`);
        }
      }
    } catch (e) {
      console.error(`[FS ERROR] Could not copy segment ${seg.timestamp} to job directory:`, e);
    }
  }

  console.log(`[CLIP] Resetting segment buffer in TEMP_DIR to prevent overlap for next clip...`);
  for (const seg of segments) {
    if (seg.time === activeSegmentTimestamp) {
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
      console.error(`[FS ERROR] Could not delete segment ${seg.timestamp} from TEMP_DIR:`, e);
    }
  }

  /** @type {string} */
  const listVideoPath = path.join(jobDir, 'concat_video.txt');
  /** @type {string} */
  const listSysPath = path.join(jobDir, 'concat_sys.txt');
  /** @type {string} */
  const listMicPath = path.join(jobDir, 'concat_mic.txt');

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
      console.log(`[FFMPEG - ${jobId}] Separate audio tracks enabled.`);
      ffmpegArgs.push('-map', '0:v', '-map', '1:a', '-map', '2:a');
    } else {
      console.log(`[FFMPEG - ${jobId}] Merged audio track enabled (amix filter).`);
      ffmpegArgs.push('-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest[aout]');
      ffmpegArgs.push('-map', '0:v', '-map', '[aout]');
    }
  } else {
    console.log(`[FFMPEG - ${jobId}] Single system audio track enabled.`);
    ffmpegArgs.push('-map', '0:v', '-map', '1:a');
  }

  ffmpegArgs.push(
    '-c:v',
    currentConfig.videoCodec,
    '-preset',
    currentConfig.videoPreset,
    currentConfig.videoQualityCmd,
    String(currentConfig.videoQualityValue),
    '-c:a',
    currentConfig.audioCodec,
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  );

  /** @type {import('child_process').ChildProcessWithoutNullStreams} */
  const concatProcess = spawn('ffmpeg', ffmpegArgs, { env: process.env });
  activeConcatProcesses.add(concatProcess);

  concatProcess.stderr.on('data', (data) => {
    /** @type {string} */
    const msg = data.toString().trim();
    if (msg.toLowerCase().includes('error')) {
      console.error(`[CLIP FFmpeg - ${jobId}] ${msg}`);
    }
  });

  concatProcess.on('close', (code) => {
    activeConcatProcesses.delete(concatProcess);

    clipsProcessingCount--;
    if (clipsProcessingCount <= 0) {
      clipsProcessingCount = 0;
      if (tray) tray.setImage(appIconPath);
    }

    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[SYSTEM] Failed to clean up job directory ${jobId}:`, e);
    }

    /** @type {string} */
    const queueStatus =
      clipsProcessingCount > 0 ? `(${clipsProcessingCount} remaining in queue)` : '';

    if (code === 0) {
      console.log(`[CLIP SUCCESS] MP4 Assembly complete: ${outputPath}`);
      sendNotification(
        {
          title: 'Clip Saved!',
          urgency: 'critical',
          body: `Successfully saved: ${path.basename(outputPath)}\nClick here to view. ${queueStatus}`.trim(),
        },
        clipSound,
        () => {
          shell.showItemInFolder(outputPath);
        },
      );
    } else {
      console.error(`[CLIP ERROR] Assembly failed with code: ${code}`);
      sendNotification(
        {
          title: 'Clipping Error',
          urgency: 'critical',
          body: `Failed to save clip. FFmpeg exited with code ${code}. ${queueStatus}`.trim(),
        },
        failSound,
      );
    }
  });

  concatProcess.on('error', (err) => {
    activeConcatProcesses.delete(concatProcess);

    clipsProcessingCount--;
    if (clipsProcessingCount <= 0) {
      clipsProcessingCount = 0;
      if (tray) tray.setImage(appIconPath);
    }

    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch (e) {
      console.error(e);
    }

    console.error(`[CLIP ERROR] Failed to spawn FFmpeg process:`, err);
    sendNotification(
      {
        title: 'System Error',
        urgency: 'critical',
        body: `Could not start the video processing engine.`,
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
    if (windowsCache.captureWindow)
      windowsCache.captureWindow.webContents.send('capture-command', { action: 'stop' });

    globalShortcut.unregisterAll();
    createConfigWindow();
    dialog.showErrorBox(
      'Invalid Save Directory',
      'The folder configured to save videos does not exist or is invalid.',
    );
    return;
  }

  globalShortcut.unregisterAll();
  if (config.enableClipping) {
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
  }

  // Only start the server if enabled in config
  if (config && config.streamEnabled) {
    startStreamServer(config, windowsCache.captureWindow.webContents);
  }

  if (config.enableClipping) {
    startRecording(config);
    /** @type {string} */
    const readyMessage = isWaylandEnv
      ? 'Engine is active! Ready to save clips.'
      : `Engine is active! Press ${config.shortcut} to save a clip.`;

    sendNotification({
      title: 'Tiny Pony Clipper',
      urgency: 'normal',
      body: readyMessage,
    });
  } else {
    // Stop the engine completely if disabled
    if (windowsCache.captureWindow) {
      windowsCache.captureWindow.webContents.send('capture-command', { action: 'stop' });
    }
    currentConfig = config;
    sendNotification({
      title: 'Tiny Pony Clipper',
      urgency: 'normal',
      body: 'Gamepad Server is active! (Audio/Video Engine is Disabled)',
    });
  }
};

/**
 * @returns {Promise<void>}
 */
const createHiddenCaptureWindow = async () => {
  windowsCache.captureWindow = new BrowserWindow({
    show: false,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(srcFolder, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await windowsCache.captureWindow.loadFile(path.join(srcFolder, 'capture.html'));
};

/**
 * @returns {void}
 */
const createConfigWindow = () => {
  console.log('[UI] Requesting configuration window...');
  if (windowsCache.configWindow) {
    console.log('[UI] Window already exists, focusing it.');
    windowsCache.configWindow.focus();
    return;
  }
  windowsCache.configWindow = new BrowserWindow({
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
  windowsCache.configWindow.loadFile(path.join(srcFolder, 'index.html'));
  windowsCache.configWindow.once('ready-to-show', () => {
    console.log('[UI] Window ready to show.');
    windowsCache.configWindow.show();
  });
  windowsCache.configWindow.on('closed', () => {
    console.log('[UI] Window closed.');
    windowsCache.configWindow = null;
  });
};

/**
 * @returns {void}
 */
const toggleConfigWindow = () => {
  if (windowsCache.configWindow) {
    if (windowsCache.configWindow.isVisible()) {
      windowsCache.configWindow.hide();
    } else {
      windowsCache.configWindow.show();
      windowsCache.configWindow.focus();
    }
  } else {
    createConfigWindow();
  }
};

if (gotTheLock) {
  app.whenReady().then(async () => {
    // Expose gamepad status to the UI
    ipcMain.handle('get-gamepad-status', () => canAccessUinput());

    // Handle Gamepad Inputs from WebRTC DataChannel
    ipcMain.on('gamepad-input', (event, data) => {
      if (data.type === 'multi_input') {
        for (const pad of data.pads) {
          if (pad.index >= currentConfig.maxGamepads) {
            if (!warnedPads.has(pad.index)) {
              warnedPads.add(pad.index);
              console.warn(
                `[STREAM WARN] Rejected gamepad ${pad.index} - Max limit of ${currentConfig.maxGamepads} reached.`,
              );
              sendSignalToClient({
                type: 'server_warning',
                message: `Gamepad [${pad.index}] blocked: Server max limit of ${currentConfig.maxGamepads} reached.`,
              });
            }
            continue;
          }

          /** @type {string} */
          const status = updateGamepadState(pad.index, pad, currentConfig.gamepadType);

          if (status === 'LIMIT_REACHED' && !warnedPads.has(pad.index)) {
            warnedPads.add(pad.index);
            console.warn(
              `[STREAM WARN] Rejected gamepad ${pad.index} - Max limit of ${currentConfig.maxGamepads} reached.`,
            );
            sendSignalToClient({
              type: 'server_warning',
              message: `Gamepad [${pad.index}] blocked: Server max limit of 12 reached.`,
            });
          }
        }
      }
    });

    // Route WebRTC signals back to the StreamServer
    ipcMain.on('webrtc-signal-back', (event, data) => {
      sendSignalToClient(data);
    });

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
      tray.on('click', toggleConfigWindow);
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

    ipcMain.handle('is-wayland', () => isWaylandEnv);

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
    destroyAllGamepads();
    globalShortcut.unregisterAll();
    console.log('[SYSTEM] Application is quitting.');

    if (audioProcess) {
      console.log('[SYSTEM] Killing audio process...');
      audioProcess.kill('SIGKILL');
    }

    let i = 0;
    for (const p of activeConcatProcesses) {
      i++;
      console.log(`[SYSTEM] [${i}] Killing active concat process...`);
      p.kill('SIGKILL');
    }

    if (cleanupInterval) clearInterval(cleanupInterval);
    console.log('[SYSTEM] Tiny Jasmini: Tiny bye :3');
  });
}
