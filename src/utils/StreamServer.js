import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { srcFolder } from './values.js';

/** @type {http.Server | null} */
let currentServer = null;

/** @type {WebSocketServer | null} */
let currentWss = null;

/** @type {import('ws').WebSocket | null} */
let activeClientWs = null;

/**
 * @param {Object} config
 * @param {Electron.WebContents} captureWebContents
 * @returns {void}
 */
export const startStreamServer = (config, captureWebContents) => {
  if (currentServer) {
    currentServer.close();
    if (currentWss) currentWss.close();
  }

  currentServer = http.createServer((req, res) => {
    if (req.url === '/') {
      /** @type {string} */
      const clientHtmlPath = path.join(srcFolder, './public/client.html');

      fs.readFile(clientHtmlPath, (err, data) => {
        if (err) {
          console.error('[STREAM ERROR] Failed to load client UI:', err);
          res.writeHead(500);
          res.end('Error loading client UI');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  currentWss = new WebSocketServer({ server: currentServer });

  currentWss.on('connection', (ws) => {
    /** @type {boolean} */
    let isAuthenticated = false;

    ws.on('message', (message) => {
      /** @type {Object} */
      const data = JSON.parse(message.toString());

      if (data.type === 'auth') {
        if (data.password === config.streamPassword) {
          isAuthenticated = true;
          activeClientWs = ws; // Save the active connection here
          ws.send(
            JSON.stringify({
              type: 'auth_success',
              enableVideo: config.enableClipping,
              iceServers: config.iceServers,
            }),
          );
          console.log('[STREAM] Client authenticated successfully!');
        } else {
          ws.send(JSON.stringify({ type: 'auth_error' }));
          ws.close();
          console.log('[STREAM] Client authentication failed.');
        }
        return;
      }

      if (!isAuthenticated) return;

      if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
        captureWebContents.send('webrtc-signal', data);
      }
    });

    ws.on('close', () => {
      if (activeClientWs === ws) {
        activeClientWs = null;
        console.log('[STREAM] Client disconnected.');
      }
    });
  });

  currentServer.listen(config.streamPort, '0.0.0.0', () => {
    console.log(`[STREAM] Web server running securely on port ${config.streamPort}`);
  });
};

/**
 * @param {Object} data
 * @param {string} data.type
 * @param {RTCSessionDescriptionInit} [data.answer]
 * @param {RTCIceCandidateInit} [data.candidate]
 * @returns {void}
 */
export const sendSignalToClient = (data) => {
  if (activeClientWs && activeClientWs.readyState === 1) {
    // 1 === OPEN
    activeClientWs.send(JSON.stringify(data));
  }
};
