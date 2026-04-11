import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { srcFolder } from './values.js';

/** @type {http.Server | null} */
let currentServer = null;

/** @type {WebSocketServer | null} */
let currentWss = null;

// Map to track websockets so we can kick clients
/** @type {Map<string, import('ws').WebSocket>} */
const activeWsClients = new Map();

/**
 * Maps file extensions to their respective MIME types.
 * @type {Record<string, string>}
 */
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Serves a static file with optional content transformations.
 *
 * @param {http.ServerResponse} res
 * { http.ServerResponse } res
 * @param {string} filePath
 * { string } filePath
 * @param {string} contentType
 * { string } contentType
 * @param {boolean} isHostRoot
 * { boolean } isHostRoot
 * @returns {void}
 */
const serveFile = (res, filePath, contentType, isHostRoot = false) => {
  const encoding =
    contentType.startsWith('text') || contentType === 'application/javascript' ? 'utf-8' : null;

  fs.readFile(filePath, encoding, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        const errorPage = path.join(srcFolder, './public/404.html');
        fs.readFile(errorPage, 'utf-8', (err404, data404) => {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end(err404 ? '404 Not Found' : data404);
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
      return;
    }

    let output = data;

    // Apply specific replacements based on the user preferences and original logic
    if (isHostRoot && contentType === 'text/html') {
      output = data
        .replace('id="serverHost"', 'id="serverHost" disabled')
        .replace('id="connectionMethod"', 'id="connectionMethod" style="display: none;"');
    }

    if (isHostRoot && contentType === 'application/javascript') {
      output = data.replace(/\(\'pony\_stream\_/g, "('host_pony_stream_");
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(output);
  });
};

const filePath = {
  '/img/tray-icon.png': path.join(srcFolder, './icons/tray-icon.png'),
  '/img/tray-icon.ico': path.join(srcFolder, './icons/tray-icon.ico'),
  '/img/tray-icon-processing.png': path.join(srcFolder, './icons/tray-icon-processing.png'),
  '/img/tray-icon-processing.ico': path.join(srcFolder, './icons/tray-icon-processing.ico'),
};

/**
 * Initializes and starts the local HTTP and WebSocket servers for Remote Play.
 * Serves the client UI and handles WebSocket authentication and WebRTC signaling.
 *
 * @param {Object} config - The active application configuration object.
 * @param {Electron.WebContents} captureWebContents - The WebContents instance of the hidden capture window.
 * @returns {void}
 */
export const startStreamServer = (config, captureWebContents) => {
  if (currentServer) {
    currentServer.close();
    if (currentWss) currentWss.close();
  }

  currentServer = http.createServer((req, res) => {
    const isHostRoot = req.url === '/';
    /** @type {string} */
    let fullPath;

    // Specific case for the tray icon residing outside the public folder
    if (filePath[req.url]) {
      fullPath = filePath[req.url];
    } else {
      /** @type {string} */
      const urlPath = isHostRoot || req.url === '/public' ? '/index.html' : req.url;
      fullPath = path.join(srcFolder, './public', urlPath);
    }

    /** @type {string} */
    const ext = path.extname(fullPath).toLowerCase();
    /** @type {string} */
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    serveFile(res, fullPath, contentType, isHostRoot);
  });

  currentWss = new WebSocketServer({ server: currentServer });

  currentWss.on('connection', (ws) => {
    /** @type {boolean} */
    let isAuthenticated = false;
    /** @type {string | null} */
    let clientId = null;

    ws.on('message', (message) => {
      /** @type {Object} */
      const data = JSON.parse(message.toString());

      if (data.type === 'auth') {
        if (data.password === config.streamPassword) {
          isAuthenticated = true;

          // We generate the ID here and register the WebSocket
          clientId = `ip_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          activeWsClients.set(clientId, ws);

          ws.send(
            JSON.stringify({
              type: 'auth_success',
              enableVideo: config.enableClipping && config.streamVideoEnabled,
              iceServers: config.iceServers,
              clientId: clientId,
            }),
          );
          console.log(`[STREAM] Client [${clientId}] authenticated successfully!`);
        } else {
          ws.send(JSON.stringify({ type: 'auth_error' }));
          ws.close();
          console.log('[STREAM] Client authentication failed.');
        }
        return;
      }

      if (!isAuthenticated || !clientId) return;

      if (['offer', 'answer', 'ice_candidate'].includes(data.type)) {
        data.clientId = clientId;
        captureWebContents.send('webrtc-signal', data);
      }
    });

    ws.on('close', () => {
      if (clientId && activeWsClients.has(clientId)) {
        activeWsClients.delete(clientId);
        console.log(`[STREAM] Client [${clientId}] WebSocket disconnected.`);
      }
    });
  });

  currentServer.listen(config.streamPort, '0.0.0.0', () => {
    console.log(`[STREAM] Web server running securely on port ${config.streamPort}`);
  });
};

/**
 * Sends a WebRTC signaling payload or an event message directly to a specific connected WebSocket client.
 *
 * @param {Object} data - The payload to send.
 * @param {string} data.type - The type of signal or message.
 * @param {string} data.clientId - The target client's unique identifier.
 * @param {RTCSessionDescriptionInit} [data.answer] - The WebRTC answer object (optional).
 * @param {RTCIceCandidateInit} [data.candidate] - The WebRTC ICE candidate object (optional).
 * @returns {void}
 */
export const sendSignalToClient = (data) => {
  if (data.clientId && activeWsClients.has(data.clientId)) {
    /** @type {import('ws').WebSocket} */
    const ws = activeWsClients.get(data.clientId);
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  }
};

/**
 * Forcefully closes a WebSocket connection for a given client after sending a warning message.
 * Removes the client from the active connections map.
 *
 * @param {string} clientId - The unique identifier of the client to be kicked.
 * @returns {void}
 */
export const kickWsClient = (clientId) => {
  if (activeWsClients.has(clientId)) {
    /** @type {import('ws').WebSocket} */
    const ws = activeWsClients.get(clientId);
    ws.send(
      JSON.stringify({ type: 'server_warning', message: 'You have been kicked by the host.' }),
    );
    ws.close();
    activeWsClients.delete(clientId);
  }
};
