import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { app } from 'electron';

import { compressToBase64, decompressFromBase64 } from './public/js/gzipBase64.js';

/** @type {boolean} */
export const gotTheLock = app.requestSingleInstanceLock();

/**
 * @param {string[]} args
 * @returns {boolean}
 */
export const isCLICommand = (args) => {
  return args.some((arg) => ['--process-sdp', '--help', '--exit', 'exit'].includes(arg));
};

/** @type {string} */
const SOCKET_PATH = path.join(os.tmpdir(), 'tiny_pony_clipper.sock');

/** @type {string} */
const PIPE_PATH = process.platform === 'win32' ? '\\\\.\\pipe\\tiny_pony_clipper' : SOCKET_PATH;

/** @type {number} */
let lastExecutionTime = 0;

/** @type {number} */
const RATE_LIMIT_MS = 3000;

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export const runCLIClient = (args) => {
  return new Promise((resolve) => {
    if (args.includes('--help')) {
      /** @type {Object} */
      const helpOutput = {
        status: 'success',
        commands: {
          '--process-sdp [base64]': 'Processes an SDP offer for P2P connection.',
          '--exit': 'Closes the application and shuts down the server.',
          exit: 'Alternative to the --exit command.',
          '--help': 'Shows this list of commands.',
          '--force-stream': 'Forces the server to start on initialization.',
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

    if (args.includes('--exit') || args.includes('exit')) {
      /** @type {net.Socket} */
      const exitClient = net.createConnection(PIPE_PATH, () => {
        exitClient.write('CMD_EXIT');
      });

      exitClient.on('data', (data) => {
        console.log(data.toString());
        exitClient.end();
      });

      exitClient.on('end', () => resolve());

      exitClient.on('error', () => {
        console.log(
          JSON.stringify({
            status: 'error',
            error: 'Tiny Pony Clipper is not currently running.',
          }),
        );
        resolve();
      });
      return;
    }

    /** @type {number} */
    const sdpIndex = args.indexOf('--process-sdp');

    if (sdpIndex === -1 || sdpIndex === args.length - 1) {
      console.log(JSON.stringify({ status: 'error', error: 'Invalid sdp code!' }));
      resolve();
      return;
    }

    /** @type {string} */
    const base64Offer = args[sdpIndex + 1];

    /** @type {net.Socket} */
    const client = net.createConnection(PIPE_PATH, () => {
      client.write(base64Offer);
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
 * @param {function(string): Promise<string | null>} processSdpCallback
 * @returns {net.Server}
 */
export const startCLIServer = (processSdpCallback) => {
  /** @type {net.Server} */
  const server = net.createServer((socket) => {
    socket.on('data', async (data) => {
      /** @type {string} */
      const payloadString = data.toString().trim();

      if (payloadString === 'CMD_EXIT') {
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

      if (timeDiff < RATE_LIMIT_MS) {
        /** @type {number} */
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
        /** @type {string} */
        const offerString = await decompressFromBase64(payloadString);
        JSON.parse(offerString);

        /** @type {string | null} */
        const answerString = await processSdpCallback(offerString);

        if (!answerString) {
          socket.write(
            JSON.stringify({ status: 'error', error: 'Server failed to generate an answer' }),
          );
          socket.end();
          return;
        }

        /** @type {string} */
        const b64Answer = await compressToBase64(answerString);
        socket.write(JSON.stringify({ status: 'success', data: b64Answer }));
      } catch (error) {
        socket.write(
          JSON.stringify({
            status: 'error',
            error: 'Invalid SDP payload or processing failure',
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
 * @param {string[]} args
 * @returns {Object}
 */
export const parseCLIConfigOverrides = (args) => {
  /** @type {Object} */
  const overrides = {};

  if (args.includes('--force-stream')) {
    overrides.streamEnabled = true;
  }

  for (let i = 0; i < args.length; i++) {
    /** @type {string} */
    const arg = args[i];
    /** @type {string | undefined} */
    const nextArg = args[i + 1];

    if (arg === '--stream-port' && nextArg) overrides.streamPort = parseInt(nextArg, 10);
    if (arg === '--stream-password' && nextArg) overrides.streamPassword = nextArg;
    if (arg === '--max-gamepads' && nextArg) overrides.maxGamepads = parseInt(nextArg, 10);
    if (arg === '--ice-servers' && nextArg) overrides.iceServers = nextArg;

    if (arg === '--enable-clipping' && nextArg) {
      overrides.enableClipping = nextArg === 'true';
    }
    if (arg === '--stream-video-enabled' && nextArg) {
      overrides.streamVideoEnabled = nextArg === 'true';
    }
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
