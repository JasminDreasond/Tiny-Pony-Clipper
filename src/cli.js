import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { app } from 'electron';

import { compressToBase64, decompressFromBase64 } from './public/js/gzipBase64.js';

/**
 * Indicates if the current application instance has successfully acquired the single-instance lock.
 * @type {boolean}
 */
export const gotTheLock = app.requestSingleInstanceLock();

/**
 * Checks if the provided command line arguments contain any known CLI commands.
 *
 * @param {string[]} args - The command line arguments to evaluate.
 * @returns {boolean} True if a CLI command is present, false otherwise.
 */
export const isCLICommand = (args) => {
  return args.some((arg) =>
    [
      '--process-sdp',
      '--exit',
      'exit',
      '--help',
      '--client-status',
      '--client-connect-ip',
      '--client-connect-sdp',
      '--client-offer',
    ].includes(arg),
  );
};

/**
 * Retrieves the executable path of the parent process that spawned the CLI.
 *
 * @returns {string} The path to the caller executable or a fallback identifier.
 */
export const getCallerExecutable = () => {
  try {
    if (process.platform === 'linux') {
      return fs.readlinkSync(`/proc/${process.ppid}/exe`);
    }
    return `Process ID: ${process.ppid}`;
  } catch (e) {
    return 'Unknown Application';
  }
};

/**
 * The file path for the Unix domain socket used for IPC communication on Unix-like systems.
 * @type {string}
 */
const SOCKET_PATH = path.join(os.tmpdir(), 'tiny_pony_clipper.sock');

/**
 * The platform-specific path for the named pipe or socket used by the CLI server.
 * @type {string}
 */
const PIPE_PATH = process.platform === 'win32' ? '\\\\.\\pipe\\tiny_pony_clipper' : SOCKET_PATH;

/**
 * Timestamp of the last time a CLI command was processed, used to enforce rate limits.
 * @type {number}
 */
let lastExecutionTime = 0;

/**
 * The minimum allowed time interval (in milliseconds) between CLI command executions.
 * @type {number}
 */
const RATE_LIMIT_MS = 3000;

/**
 * Executes the CLI client logic, parsing arguments and sending commands via IPC socket to the main process.
 *
 * @param {string[]} args - The command line arguments to process.
 * @returns {Promise<void>} Resolves when the CLI operation completes.
 */
export const runCLIClient = (args) => {
  return new Promise((resolve) => {
    if (args.includes('--help')) {
      /** @type {Object} */
      const helpOutput = {
        status: 'success',
        commands: {
          '--process-sdp [base64]': 'Processes an SDP offer for P2P connection as the Host server.',
          '--exit': 'Closes the application and shuts down the server.',
          '--client-status': 'Checks the active playing status of the local Remote Play Client.',
          '--client-connect-ip [ip] [pass]':
            'Forces the local Remote Play Client connection. Optional: --video, --audio, --kbpad [true/false]',
          '--client-connect-sdp [base64]':
            'Forces the local Remote Play Client SDP connection. Optional: --video, --audio, --kbpad [true/false]',
          '--client-offer': 'Generates a WebRTC Offer from the local Remote Play Client.',
          '--force-stream [true/false]': 'Forces the server to start on initialization.',
          '--stream-port [port]': 'Sets the WebSocket/HTTP server port.',
          '--stream-password [password]': 'Sets the stream access password.',
          '--max-gamepads [number]': 'Sets the maximum limit of gamepads.',
          '--ice-servers [urls]': 'Overrides the default ICE servers.',
          '--enable-clipping [true/false]': 'Enables or disables local video clipping.',
          '--stream-video-enabled [true/false]': 'Enables or disables the video stream.',
        },
      };
      console.log(JSON.stringify(helpOutput, null, 2));
      resolve();
      return;
    }

    /** @type {string} */
    const callerApp = getCallerExecutable();
    /** @type {{ cmd: string; action?: string; data?: string; host?: string; past?: string; } | null} */
    let commandPayload = null;

    // Helper to safely extract boolean optional flags
    const getOptionalBool = (flagName) => {
      const idx = args.indexOf(flagName);
      if (idx !== -1 && args.length > idx + 1) return args[idx + 1] === 'true';
      return undefined;
    };

    /** @type {boolean|undefined} */ const optVideo = getOptionalBool('--video');
    /** @type {boolean|undefined} */ const optAudio = getOptionalBool('--audio');
    /** @type {boolean|undefined} */ const optKbPad = getOptionalBool('--kbpad');

    if (args.includes('--exit') || args.includes('exit')) {
      commandPayload = { cmd: 'CMD_EXIT' };
    } else if (args.includes('--process-sdp')) {
      const idx = args.indexOf('--process-sdp');
      if (idx !== -1 && idx !== args.length - 1) {
        commandPayload = { cmd: 'CMD_PROCESS_SDP', data: args[idx + 1] };
      }
    } else if (args.includes('--client-status')) {
      commandPayload = { cmd: 'CMD_API', action: 'check_session_status' };
    } else if (args.includes('--client-offer')) {
      commandPayload = { cmd: 'CMD_API', action: 'generate_offer' };
    } else if (args.includes('--client-connect-ip')) {
      const idx = args.indexOf('--client-connect-ip');
      if (idx !== -1 && args.length >= idx + 3) {
        commandPayload = {
          cmd: 'CMD_API',
          action: 'connect_ip',
          host: args[idx + 1],
          pass: args[idx + 2],
        };
      }
    } else if (args.includes('--client-connect-sdp')) {
      const idx = args.indexOf('--client-connect-sdp');
      if (idx !== -1 && args.length >= idx + 2) {
        commandPayload = { cmd: 'CMD_API', action: 'connect_sdp', answer: args[idx + 1] };
      }
    }

    // Attach optional API overrides if they exist and an API command was formed
    if (commandPayload && commandPayload.cmd === 'CMD_API') {
      if (optVideo !== undefined) commandPayload.video = optVideo;
      if (optAudio !== undefined) commandPayload.audio = optAudio;
      if (optKbPad !== undefined) commandPayload.kbpad = optKbPad;
    }

    if (!commandPayload) {
      console.log(
        JSON.stringify({ status: 'error', error: 'Invalid command or missing arguments!' }),
      );
      resolve();
      return;
    }

    commandPayload.caller = callerApp;

    /** @type {net.Socket} */
    const client = net.createConnection(PIPE_PATH, () => {
      client.write(JSON.stringify(commandPayload));
    });

    client.on('data', (data) => {
      console.log(data.toString());
      client.end();
    });

    client.on('end', () => resolve());

    client.on('error', (err) => {
      console.log(
        JSON.stringify({
          status: 'error',
          error: 'Application is not running or socket error',
          details: err.message,
        }),
      );
      resolve();
    });
  });
};

/**
 * Starts the local IPC server to listen for and process incoming CLI commands.
 *
 * @param {function(string): Promise<string | null>} processSdpCallback - Callback function to handle SDP processing.
 * @param {function(string): Promise<boolean>} authCallback
 * @param {function(Object): Promise<Object>} clientApiCallback
 * @returns {net.Server}
 */
export const startCLIServer = (processSdpCallback, authCallback, clientApiCallback) => {
  /** @type {net.Server} */
  const server = net.createServer((socket) => {
    socket.on('data', async (data) => {
      /** @type {Object} */
      let parsed;
      /** @type {string} */
      let callerApp;

      try {
        parsed = JSON.parse(data.toString().trim());
        callerApp = parsed.caller || 'Unknown Application';
      } catch (e) {
        socket.write(JSON.stringify({ status: 'error', error: 'Malformed JSON payload from CLI' }));
        socket.end();
        return;
      }

      /** @type {boolean} */
      const isAuthorized = await authCallback(callerApp);
      if (!isAuthorized) {
        socket.write(JSON.stringify({ status: 'error', error: 'Permission denied by user' }));
        socket.end();
        return;
      }

      if (parsed.cmd === 'CMD_EXIT') {
        socket.write(
          JSON.stringify({ status: 'success', message: 'Application is shutting down.' }),
        );
        socket.end();
        app.quit();
        return;
      }

      /** @type {number} */
      const now = Date.now();
      /** @type {number} */
      const timeDiff = now - lastExecutionTime;

      // Rate limit bypasses status checks so scripts don't hang if just polling
      if (timeDiff < RATE_LIMIT_MS && parsed.action !== 'check_session_status') {
        const remaining = (RATE_LIMIT_MS - timeDiff) / 1000;
        socket.write(
          JSON.stringify({
            status: 'error',
            error: 'Rate limit exceeded',
            cooldown: Number(remaining.toFixed(1)),
          }),
        );
        socket.end();
        return;
      }

      lastExecutionTime = now;

      try {
        if (parsed.cmd === 'CMD_PROCESS_SDP') {
          const offerString = await decompressFromBase64(parsed.data);
          JSON.parse(offerString);

          const answerString = await processSdpCallback(offerString);
          if (!answerString) {
            socket.write(
              JSON.stringify({ status: 'error', error: 'Server failed to generate an answer' }),
            );
            socket.end();
            return;
          }

          const b64Answer = await compressToBase64(answerString);
          socket.write(JSON.stringify({ status: 'success', data: b64Answer }));
        } else if (parsed.cmd === 'CMD_API') {
          // Send request to the Hosted Client Window!
          const apiResponse = await clientApiCallback(parsed);
          socket.write(JSON.stringify(apiResponse));
        }
      } catch (error) {
        socket.write(
          JSON.stringify({
            status: 'error',
            error: 'Processing failure',
            details: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      socket.end();
    });
  });

  if (process.platform !== 'win32') {
    if (fs.existsSync(PIPE_PATH)) {
      try {
        fs.unlinkSync(PIPE_PATH);
      } catch (e) {
        console.error(e);
      }
    }
  }

  server.listen(PIPE_PATH);
  return server;
};

/**
 * Reorganizes command line arguments by pairing flags with trailing positional values.
 * @param {string[]} argv
 * @returns {string[]}
 */
export const reorganizeArgv = (argv) => {
  /** @type {string[]} */
  const flagsNeedingValues = [];
  /** @type {string[]} */
  const values = [];
  /** @type {string[]} */
  const selfContained = [];

  // We skip the first element (app path)
  /** @type {string[]} */
  const cleanArgs = argv.slice(1);

  cleanArgs.forEach((arg) => {
    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        selfContained.push(arg);
      } else {
        flagsNeedingValues.push(arg);
      }
    } else {
      values.push(arg);
    }
  });

  /** @type {string[]} */
  const reconstructed = [];

  // Pair flags with values based on discovery order
  flagsNeedingValues.forEach((flag) => {
    reconstructed.push(flag);
    // Shift the first available value to pair with this flag
    if (values.length > 0) reconstructed.push(values.shift());
  });

  // Append self-contained flags (--key=value) and remaining positionals
  return [...reconstructed, ...selfContained, ...values];
};

/**
 * Inverts a flag configuration object to map property names to their respective flags.
 * @param {Object.<string, [string, Function]>} config
 * @returns {Object.<string, string>}
 */
const invertFlagsConfig = (config) => {
  /** @type {Array<[string, [string, Function]]>} */
  const entries = Object.entries(config);

  /** @type {Object.<string, string>} */
  return entries.reduce((acc, [flag, [propName]]) => {
    acc[propName] = flag;
    return acc;
  }, {});
};

/**
 * @type {([string, (nextArg: string) => any])[]}
 */
const flagsOptions = {
  '--stream-port': ['streamPort', (nextArg) => parseInt(nextArg, 10)],
  '--stream-password': ['streamPassword', (nextArg) => nextArg],
  '--max-gamepads': ['maxGamepads', (nextArg) => parseInt(nextArg, 10)],
  '--ice-servers': ['iceServers', (nextArg) => nextArg],
  '--enable-clipping': ['enableClipping', (nextArg) => nextArg === 'true'],
  '--stream-video-enabled': ['streamVideoEnabled', (nextArg) => nextArg === 'true'],
  '--force-stream': ['forceStream', (nextArg) => nextArg === 'true'],
};

const validFlags = Object.values(flagsOptions).map((item) => item[0]);

export const flagsArgs = invertFlagsConfig(flagsOptions);

/**
 * Flattens an arg object into a key-value array, filtering by allowed keys.
 * @param {Object} data
 * @returns {Array<string|any>}
 */
export const flattenFilteredArgs = (data) => {
  /** @type {Array<[string, any]>} */
  const entries = Object.entries(data);
  /** @type {Array<[string, any]>} */
  const filtered = entries.filter(([key]) => validFlags.includes(key));
  return filtered.flat();
};

/**
 * Parses command line arguments to extract configuration overrides for the application.
 *
 * @param {string[]} args - The command line arguments to parse.
 * @returns {Object} An object containing the overridden configuration values.
 */
export const parseCLIConfigOverrides = (args) => {
  /** @type {Object} */
  const overrides = {};

  for (let i = 0; i < args.length; i++) {
    /** @type {string} */
    const arg = args[i];
    /** @type {string | undefined} */
    const nextArg = args[i + 1];
    const argData = flagsOptions[arg];
    if (argData && nextArg) overrides[argData[0]] = argData[1](nextArg);
  }

  // Force streamEnabled to true if any stream related argument is passed
  if (
    overrides.streamPort !== undefined ||
    overrides.streamPassword !== undefined ||
    overrides.maxGamepads !== undefined ||
    overrides.iceServers !== undefined ||
    overrides.streamVideoEnabled !== undefined
  ) {
    overrides.streamEnabled = true;
  }

  return overrides;
};
