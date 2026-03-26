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
    if (req.url === '/' || req.url === '/public') {
      /** @type {string} */
      const clientHtmlPath = path.join(srcFolder, './public/index.html');

      fs.readFile(clientHtmlPath, 'utf-8', (err, data) => {
        if (err) {
          console.error('[STREAM ERROR] Failed to load client UI:', err);
          res.writeHead(500);
          res.end('Error loading client UI');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          req.url === '/'
            ? data
                .replace('id="serverHost"', 'id="serverHost" disabled')
                .replace(/\(\'pony_stream\_/g, "('host_pony_stream_")
                .replace('id="connectionMethod"', 'id="connectionMethod" style="display: none;"')
            : data,
        );
      });
    } else if (req.url === '/img/tray-icon.png') {
      /** @type {string} */
      const iconPath = path.join(srcFolder, './icons/tray-icon.png');

      fs.readFile(iconPath, (err, data) => {
        if (err) {
          console.error('[STREAM ERROR] Failed to load tray icon:', err);
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(data);
      });
    } else if (req.url === '/js/main.js') {
      /** @type {string} */
      const jsPath = path.join(srcFolder, './public/js/main.js');

      fs.readFile(jsPath, 'utf-8', (err, data) => {
        if (err) {
          console.error('[STREAM ERROR] Failed to load main.js:', err);
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(data);
      });
    } else {
      /** @type {string} */
      const htmlFilePath = path.join(srcFolder, './public/404.html');

      fs.readFile(htmlFilePath, (err, data) => {
        if (err) {
          console.error('[STREAM ERROR] Failed to load 404 UI:', err);
          res.writeHead(500);
          res.end('Error loading 404 page');
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(data);
      });
    }
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

      if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
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
