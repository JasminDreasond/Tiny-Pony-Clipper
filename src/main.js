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
  nativeImage,
  protocol,
  net,
} from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { pathToFileURL } from 'url';

import { sendNotification } from './utils/Notification.js';
import {
  appIconPath,
  srcFolder,
  getHardwareInfo,
  appIconProcessingPath,
  windowsCache,
  isFFmpegInstalled,
} from './utils/values.js';

import {
  canAccessUinput,
  destroyAllGamepads,
  destroyGamepadsForClient,
  updateGamepadState,
  getGamepadCountForClient,
  getTotalGamepads,
} from './utils/VirtualGamepad.js';
import { startStreamServer, sendSignalToClient, kickWsClient } from './utils/StreamServer.js';

import {
  gotTheLock,
  runCLIClient,
  startCLIServer,
  parseCLIConfigOverrides,
  isCLICommand,
  flattenFilteredArgs,
  reorganizeArgv,
  flagsArgs,
} from './cli.js';

import { checkAuth, setAuth, loadAuthList, removeAuth } from './utils/AuthManager.js';

/**
 * Register custom protocols as standard and secure before the app is ready.
 * This allows absolute paths (/) in HTML to resolve correctly to the protocol's root.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

ipcMain.on('console.log', (event, ...args) => console.log(...args));
ipcMain.on('console.error', (event, ...args) => console.error(...args));
ipcMain.on('open-external', (event, url) => shell.openExternal(url));

app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal,WebRTCPipeWireCapturer');
app.setAppUserModelId('com.jasmindreasond.tinyponyclipper');

const icoImg = nativeImage.createFromPath(appIconPath);
const icoProcessingImg = nativeImage.createFromPath(appIconProcessingPath);

/** @type {boolean} */
const isWaylandEnv = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

if (!gotTheLock) {
  // If the app is already running, we check if it's a CLI request
  if (isCLICommand(process.argv)) {
    runCLIClient(process.argv).then(() => app.quit());
  } else {
    app.quit();
  }
} else {
  if (process.argv.includes('--exit') || process.argv.includes('exit')) {
    console.log('[CLI] Exit command received on startup. Shutting down immediately.');
    app.quit();
    process.exit(0);
  }
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Prevents the config window from opening if the execution is just a CLI command
    if (isCLICommand(commandLine)) return;

    /** @type {Object} */
    const overrides = parseCLIConfigOverrides(reorganizeArgv(commandLine));

    console.log('[SYSTEM] Parsed CLI overrides from second instance:', overrides);

    if (Object.keys(overrides).length > 0) {
      /** @type {string[]} */
      const argsToPass = flattenFilteredArgs(overrides).map((item) =>
        flagsArgs[item] ? flagsArgs[item] : String(item),
      );
      console.log('[SYSTEM] Relaunching with temporary overrides...', argsToPass);

      sendNotification(
        {
          title: 'Tiny Pony Clipper',
          urgency: 'critical',
          body: 'Relaunching application to apply temporary CLI configurations...',
        },
        userSound,
      );

      app.relaunch({ args: argsToPass });
      app.quit();
      return;
    }

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
const alertSound = path.join(srcFolder, './sounds/alert.mp3');
const userSound = path.join(srcFolder, './public/sounds/notify.mp3');

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
 * Checks if a given string path exists and is a valid directory.
 *
 * @param {string} dirPath - The directory path to validate.
 * @returns {boolean} True if the directory exists and is valid, false otherwise.
 */
const isDirectoryValid = (dirPath) => {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (e) {
    return false;
  }
};

/**
 * Retrieves the absolute path to the main application configuration JSON file.
 *
 * @returns {string} The full path to config.json within the user data folder.
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
 * @property {boolean} streamVideoEnabled
 * @property {string} signalingMethod
 */

// Update your default config function
/**
 * Generates and returns the default application configuration object.
 *
 * @returns {AppConfig} The default configuration settings.
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
  streamMaxBitrate: 15000000,
  streamDegradation: 'maintain-framerate',
  streamEnabled: false,
  streamVideoEnabled: true,
  streamPort: 8080,
  streamPassword: 'pony',
  gamepadType: 'xbox',
  maxGamepads: 12,
  iceServers: 'stun:stun.l.google.com:19302',
  signalingMethod: 'auto',
});

/**
 * Loads the user's configuration from the disk.
 * Falls back to default settings if the file does not exist or is malformed.
 *
 * @returns {AppConfig} The merged application configuration.
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
 * Saves the provided configuration object to the disk as a JSON file.
 *
 * @param {AppConfig} config - The configuration object to save.
 * @returns {void}
 */
const saveConfig = (config) => {
  /** @type {string} */
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  console.log(`[CONFIG] Settings saved to: ${configPath}`);
};

/**
 * Ensures that a directory exists at the specified path, creating it recursively if necessary.
 *
 * @param {string} dirPath - The target directory path.
 * @returns {void}
 */
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    console.log(`[FILE SYSTEM] Creating directory: ${dirPath}`);
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Starts a background interval to clean up old video and audio segments from the temporary directory.
 * Maintains the most recent segments based on the configured buffer duration.
 *
 * @param {number} maxMinutes - The maximum amount of minutes (segments) to keep in the buffer.
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
 * Prepares the system for a new recording session, cleans old temporary files,
 * and signals the capture window to begin recording the screen and audio.
 *
 * @param {AppConfig} config - The current application configuration.
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
    iceServers: config.iceServers,
    streamMaxBitrate: config.streamMaxBitrate, // Sent to capture.js
    streamDegradation: config.streamDegradation, // Sent to capture.js
    sysInput: config.sysInput, // Let capture.js know the audio source
  });
  startGarbageCollector(config.minutes);
};

/**
 * Processes and merges the recorded video and audio segments from the temporary directory into a final MP4 file.
 * Executes FFmpeg commands based on the selected hardware and quality settings.
 *
 * @param {string} saveDir - The directory where the final MP4 clip should be saved.
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
  if (tray) tray.setImage(icoProcessingImg);

  sendNotification(
    {
      title: 'Tiny Pony Clipper',
      urgency: 'critical',
      body: `Processing your clip... (${clipsProcessingCount} in queue)`,
      icon: icoProcessingImg,
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
      if (tray) tray.setImage(icoImg);
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
      if (tray) tray.setImage(icoImg);
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
 * Applies the parsed configuration, registers global hotkeys, and initializes either the recording engine,
 * the streaming server, or both depending on the settings.
 *
 * @param {AppConfig} config - The configuration object to apply.
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
  if (config && config.streamEnabled && config.signalingMethod === 'auto') {
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
      body: 'Gamepad Server is active! (Audio/Video Engine is Disabled)',
    });
  }
};

/**
 * Creates and displays the main graphical user interface window for settings configuration.
 *
 * @returns {void}
 */
const createHiddenCaptureWindow = async () => {
  windowsCache.captureWindow = new BrowserWindow({
    show: false,
    icon: icoImg,
    webPreferences: {
      preload: path.join(srcFolder, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await windowsCache.captureWindow.loadFile(path.join(srcFolder, 'capture.html'));
};

/**
 * Creates and displays the main graphical user interface window for settings configuration.
 *
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
    icon: icoImg,
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
 * Toggles the visibility of the configuration window. Creates it if it doesn't currently exist.
 *
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

/**
 * Updates the system tray context menu dynamically based on the Remote Play window state.
 *
 * @param {boolean} isRemotePlayOpen - Indicates whether the Remote Play window is currently open.
 * @returns {void}
 */
const updateTrayMenu = (isRemotePlayOpen) => {
  if (!tray) return;

  /**
   * @type {string}
   * The dynamic label for the Remote Play tray button.
   */
  const remotePlayLabel = isRemotePlayOpen ? 'View Remote Play Client' : 'Open Remote Play Client';

  /**
   * @type {import('electron').MenuItemConstructorOptions[]}
   * The template array for the tray context menu.
   */
  const menuTemplate = [
    { label: 'Settings', click: createConfigWindow },
    { label: remotePlayLabel, click: createRemotePlayWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
};

/**
 * Creates, maximizes, and focuses the Remote Play client window.
 *
 * @returns {void}
 */
const createRemotePlayWindow = () => {
  // If the window already exists, we ensure it gets restored, maximized, and focused
  if (windowsCache.remotePlayWindow) {
    if (windowsCache.remotePlayWindow.isMinimized()) windowsCache.remotePlayWindow.restore();
    if (!windowsCache.remotePlayWindow.isVisible()) windowsCache.remotePlayWindow.show();

    windowsCache.remotePlayWindow.maximize();
    windowsCache.remotePlayWindow.focus();
    return;
  }

  console.log('[UI] Requesting Remote Play window...');

  windowsCache.remotePlayWindow = new BrowserWindow({
    width: 1024, // Fallback width
    height: 768, // Fallback height
    show: false,
    autoHideMenuBar: true,
    icon: icoImg,
    webPreferences: {
      preload: path.join(srcFolder, 'preload-public.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Loading via our custom protocol
  windowsCache.remotePlayWindow.loadURL('app://localhost/');

  // Wait for the window to be fully ready before maximizing and showing it
  windowsCache.remotePlayWindow.once('ready-to-show', () => {
    console.log('[UI] Remote Play window ready to show. Maximizing...');
    windowsCache.remotePlayWindow.maximize();
    windowsCache.remotePlayWindow.show();
  });

  windowsCache.remotePlayWindow.on('closed', () => {
    console.log('[UI] Remote Play window closed.');
    // Completely destroy the reference
    windowsCache.remotePlayWindow = null;
    // Revert the tray menu label
    updateTrayMenu(false);
  });
};

// IPC listener to change the tray name when the preload sends the signal
ipcMain.on('remote-play-ready', () => {
  console.log('[IPC] Remote Play client signaled ready. Updating tray...');
  updateTrayMenu(true);
});

if (gotTheLock) {
  app.whenReady().then(async () => {
    if (!isFFmpegInstalled()) {
      dialog.showErrorBox(
        'FFmpeg Missing',
        'FFmpeg is not installed or not found in the system PATH.\nPlease install FFmpeg to use Tiny Pony Clipper.',
      );
      app.quit();
      return;
    }

    /**
     * Intercepts the custom 'app://' protocol to serve local files from the public directory.
     * Emulates a web server root path environment.
     *
     * @param {GlobalRequest} request - The intercepted network request.
     * @returns {Promise<GlobalResponse>} The fetched local file response.
     */
    protocol.handle('app', async (request) => {
      /** @type {URL} */
      const requestUrl = new URL(request.url);

      /** @type {string} */
      let targetPath = path.join(srcFolder, 'public', requestUrl.pathname);

      // Fallback: If the path points to a directory, serve index.html by default
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
      }

      // Fetch the file from the local disk
      /** @type {GlobalResponse} */
      const response = await net.fetch(pathToFileURL(targetPath).href);

      // Clone headers and force No-Cache to prevent memory/disk caching on the app:// protocol
      /** @type {Headers} */
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    });

    // --- CLI TO PUBLIC CLIENT BRIDGE ---
    ipcMain.on('api-response-from-client', (event, responseData) => {
      /** @type {string | undefined} */
      const requestId = responseData.requestId;
      if (requestId && pendingCliResolves.has(requestId)) {
        /** @type {function(Object | null): void} */
        const resolve = pendingCliResolves.get(requestId);
        resolve(responseData);
        pendingCliResolves.delete(requestId);
      }
    });

    // Expose gamepad status to the UI
    ipcMain.handle('get-gamepad-status', () => canAccessUinput());

    /** @type {Map<string, Object>} */
    const activeClientsMap = new Map();
    /** @type {number} */
    let lastKnownGamepadCount = 0;

    /**
     * Broadcasts the current list of connected WebRTC and WebSocket clients to the UI.
     * Maps the internal connection data into a simplified format for the renderer.
     *
     * @returns {void}
     */
    const broadcastClientList = () => {
      if (!windowsCache.configWindow) return;

      /** @type {Object[]} */
      const list = Array.from(activeClientsMap.values()).map((c) => ({
        id: c.id,
        type: c.id.startsWith('ip') ? 'IP Address' : 'Manual SDP',
        time: c.connectedAt,
        gamepads: getGamepadCountForClient(c.id),
        latency: c.latency,
      }));

      windowsCache.configWindow.webContents.send('update-client-list', {
        clients: list,
        totalGamepads: getTotalGamepads(),
        maxGamepads: currentConfig ? currentConfig.maxGamepads : 12,
      });
    };

    // Loop that updates the host UI every 2 seconds to show varying ping
    setInterval(() => {
      if (
        activeClientsMap.size > 0 &&
        windowsCache.configWindow &&
        windowsCache.configWindow.isVisible()
      ) {
        broadcastClientList();
      }
    }, 2000);

    ipcMain.on('webrtc-client-connected', (event, clientId) => {
      if (!activeClientsMap.has(clientId)) {
        activeClientsMap.set(clientId, { id: clientId, connectedAt: Date.now() });
        sendNotification(
          {
            title: 'New Player Connected!',
            urgency: 'critical',
            body: `ID: ${clientId}`,
          },
          userSound,
        );
      }
      broadcastClientList();
    });

    ipcMain.on('webrtc-client-disconnected', (event, clientId) => {
      if (activeClientsMap.has(clientId)) {
        activeClientsMap.delete(clientId);
        destroyGamepadsForClient(clientId);
        sendNotification(
          {
            title: 'Player Disconnected',
            urgency: 'critical',
            body: `ID: ${clientId} left the server.`,
          },
          userSound,
        );
        broadcastClientList();
      }
    });

    ipcMain.on('kick-client-request', (event, clientId) => {
      console.log(`[SYSTEM] Manual kick requested for: ${clientId}`);
      sendNotification(
        {
          title: 'Player Kicked',
          urgency: 'critical',
          body: `You removed: ${clientId}`,
        },
        userSound,
      );

      kickWsClient(clientId);
      if (windowsCache.captureWindow) {
        windowsCache.captureWindow.webContents.send('force-close-webrtc', clientId);
      }
      broadcastClientList();
    });

    // Handle Gamepad Inputs from WebRTC DataChannel
    ipcMain.on('gamepad-input', (event, data) => {
      // Saves the latency received through the DataChannel
      if (data.type === 'client_latency') {
        if (activeClientsMap.has(data.clientId)) {
          activeClientsMap.get(data.clientId).latency = data.latency;
        }
        return;
      }

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
          const status = updateGamepadState(
            data.clientId,
            pad.index,
            pad,
            currentConfig.gamepadType,
          );

          if (status === 'LIMIT_REACHED' && !warnedPads.has(`${data.clientId}_${pad.index}`)) {
            warnedPads.add(`${data.clientId}_${pad.index}`);
            console.warn(
              `[STREAM WARN] Rejected gamepad ${pad.index} for ${data.clientId} - Max limit of ${currentConfig.maxGamepads} reached.`,
            );

            // Tries to send via WebSocket (works for IP clients)
            sendSignalToClient({
              type: 'server_warning',
              message: `Gamepad [${pad.index}] blocked: Server max limit reached.`,
              clientId: data.clientId,
            });

            // Tries to send via WebRTC DataChannel (works for P2P clients)
            if (windowsCache.captureWindow) {
              windowsCache.captureWindow.webContents.send('send-datachannel-message', {
                clientId: data.clientId,
                payload: {
                  type: 'server_warning',
                  message: `Gamepad [${pad.index}] blocked: Server max limit reached.`,
                },
              });
            }
          }
        }

        /** @type {number} */
        const currentCount = getTotalGamepads();
        if (currentCount !== lastKnownGamepadCount) {
          lastKnownGamepadCount = currentCount;
          broadcastClientList();
        }
      }
    });

    ipcMain.on('gamepad-cleanup', (event, clientId) => {
      if (clientId === 'all') {
        destroyAllGamepads();
      } else {
        destroyGamepadsForClient(clientId);
      }
    });

    // Route WebRTC signals back to the StreamServer
    ipcMain.on('webrtc-signal-back', (event, data) => {
      sendSignalToClient(data);
    });

    /**
     * @param {Electron.IpcMainEvent} event
     * @param {string} offerString
     * @returns {void}
     */
    ipcMain.on('process-manual-offer', (event, offerString) => {
      if (windowsCache.captureWindow) {
        windowsCache.captureWindow.webContents.send('webrtc-manual-offer', offerString);
      }
    });
    /** @type {Map<string, function(string | null): void>} */
    const pendingCliResolves = new Map();

    /**
     * @param {Electron.IpcMainEvent} event
     * @param {string} answerString
     * @returns {void}
     */
    ipcMain.on('relay-manual-answer', (event, payload) => {
      /** @type {string} */
      const answerString = payload.answerString || payload;
      /** @type {string | undefined} */
      const requestId = payload.requestId;

      if (requestId && pendingCliResolves.has(requestId)) {
        /** @type {function(string | null): void} */
        const resolve = pendingCliResolves.get(requestId);
        resolve(answerString);
        pendingCliResolves.delete(requestId);
      } else if (!requestId && windowsCache.configWindow && answerString) {
        windowsCache.configWindow.webContents.send('webrtc-manual-answer', answerString);
      }
    });

    ipcMain.handle('get-auth-list', () => loadAuthList());
    ipcMain.handle('update-auth', (event, caller, isAllowed) => {
      const authAllowed = setAuth(caller, isAllowed);
      if (!authAllowed) return false;
      return true;
    });
    ipcMain.handle('delete-auth', (event, caller) => {
      const authAllowed = removeAuth(caller);
      if (!authAllowed) return false;
      return true;
    });

    /**
     * Prompts the user to authorize an unknown third-party application.
     *
     * @param {string} callerPath
     * @returns {Promise<boolean>}
     */
    const promptUserForAuth = (callerPath) => {
      return new Promise((resolve) => {
        /** @type {Electron.CrossProcessExports.BrowserWindow} */
        const authWin = new BrowserWindow({
          width: 450,
          height: 380,
          alwaysOnTop: true,
          resizable: false,
          autoHideMenuBar: true,
          icon: icoImg,
          webPreferences: {
            preload: path.join(srcFolder, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        authWin.loadFile(path.join(srcFolder, 'auth.html'));

        authWin.webContents.once('did-finish-load', () => {
          authWin.webContents.send('auth-request', callerPath);
        });

        ipcMain.once('auth-response', (event, payload) => {
          if (payload.caller === callerPath) {
            const authAllowed = setAuth(callerPath, payload.allowed);
            if (!authAllowed) resolve(false);
            resolve(payload.allowed);
            authWin.close();
          }
        });

        authWin.on('closed', () => {
          resolve(false); // Defaul deny if user closes window
        });
      });
    };

    startCLIServer(
      (offerString) => {
        // Security notification triggered every time --process-sdp is used
        sendNotification(
          {
            title: 'CLI Access Requested',
            urgency: 'critical',
            body: 'An authorized third-party application is establishing a Remote Play connection.',
          },
          alertSound,
        );

        return new Promise((resolve) => {
          /** @type {string} */
          const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
          pendingCliResolves.set(requestId, resolve);

          if (windowsCache.captureWindow) {
            // Forwards the offer to capture.js to process ICE candidates
            windowsCache.captureWindow.webContents.send('webrtc-manual-offer', {
              offerString,
              requestId,
            });
          } else {
            resolve(null);
            pendingCliResolves.delete(requestId);
          }
        });
      },
      async (callerApp) => {
        /** @type {boolean | null} */
        const status = checkAuth(callerApp);
        if (status === true) return true;
        if (status === false) return false;

        // If null, it's an unknown application, prompt the user!
        return await promptUserForAuth(callerApp);
      },

      /**
       * Bridges API requests from the local CLI directly to the active Remote Play Client window.
       *
       * @param {Object} payload - The request payload containing action and parameters.
       * @returns {Promise<Object>} The response from the client window or a timeout error.
       */
      (payload) =>
        new Promise((resolve) => {
          // Check if the client window is actually open and ready
          if (!windowsCache.remotePlayWindow || windowsCache.remotePlayWindow.isDestroyed()) {
            return resolve({
              status: 'error',
              error: 'Remote Play Client is not currently open or active.',
            });
          }

          // Generate a quick random ID for the request
          /** @type {string} */
          const requestId = Date.now().toString(36) + String(Math.random());

          // Setup a 10-second timeout so the CLI doesn't hang if the window ignores the request
          /** @type {NodeJS.Timeout} */
          const timeout = setTimeout(() => {
            if (pendingCliResolves.has(requestId)) {
              pendingCliResolves.delete(requestId);
              resolve({
                status: 'error',
                error: 'Timeout: Client window took too long to respond.',
              });
            }
          }, 60000);

          // Store the resolver in the map to be called by the IPC listener
          pendingCliResolves.set(requestId, (responseData) => {
            clearTimeout(timeout);
            resolve(responseData);
          });

          // Dispatch the event to the preload-public.js!
          windowsCache.remotePlayWindow.webContents.send('dispatch-api-request', {
            ...payload,
            requestId: requestId,
          });
        }),
    );

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
      tray = new Tray(icoImg);
      tray.setToolTip('Tiny Pony Clipper');

      // Initialize the tray menu with the window closed by default
      updateTrayMenu(false);

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

    let finalConfig = loadConfig();
    const cliOverrides = parseCLIConfigOverrides(process.argv);

    if (Object.keys(cliOverrides).length > 0) {
      console.log('[SYSTEM] Applying CLI configuration overrides...', cliOverrides);
      finalConfig = { ...finalConfig, ...cliOverrides };
    }

    applyConfigurationAndStart(finalConfig);

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
