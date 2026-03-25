/** @type {MediaRecorder | null} */
let mediaRecorder = null;

/** @type {number} */
let currentTimestamp = 0;

/** @type {NodeJS.Timeout | null} */
let segmentTimer = null;

/** @type {MediaStream | null} */
let activeStream = null;

/** @type {Map<string, RTCPeerConnection>} */
const peers = new Map();

/** @type {string[]} */
let hostIceServers = ['stun:stun.l.google.com:19302'];

/**
 * @param {MediaStream} stream
 * @returns {void}
 */
const recordSegment = (stream) => {
  /** @type {number} */
  const timestamp = Date.now();
  currentTimestamp = timestamp;

  electronAPI.startSegment(timestamp);

  /** @type {Object} */
  const options = { mimeType: 'video/webm; codecs=vp8', videoBitsPerSecond: 15000000 };
  if (MediaRecorder.isTypeSupported('video/webm; codecs=h264')) {
    options.mimeType = 'video/webm; codecs=h264';
  }

  mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size > 0) {
      /** @type {ArrayBuffer} */
      const buffer = await e.data.arrayBuffer();
      electronAPI.sendVideoChunk({
        buffer: buffer,
        timestamp: timestamp,
      });
    }
  };

  mediaRecorder.start(1000);

  segmentTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      recordSegment(stream);
    }
  }, 60000);
};

electronAPI.onCaptureCommand(async (data) => {
  if (data.action === 'start') {
    try {
      /** @type {number} */
      const targetFps = data.frameRate ?? 60;

      if (data.iceServers) {
        /** @type {string[]} */
        const parsedUrls = data.iceServers
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
        if (parsedUrls.length > 0) hostIceServers = parsedUrls;
        electronAPI.log('[HOST ICE SERVERS]', parsedUrls);
      }

      /** @type {MediaStream} */
      const rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', frameRate: { ideal: targetFps, max: targetFps } },
        audio: data.streamEnabled ? { suppressLocalAudioPlayback: false } : false,
      });

      activeStream = rawStream;

      electronAPI.log(`[CAPTURE] Video engine started: @ ${targetFps}fps`);
      recordSegment(activeStream);

      rawStream.getVideoTracks()[0].onended = () => {
        electronAPI.log('[CAPTURE] Wayland stream ended by user.');
      };
    } catch (error) {
      electronAPI.error('[CAPTURE ERROR] Wayland Portal denied or failed.', error);
    }
  } else if (data.action === 'stop') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (segmentTimer) clearTimeout(segmentTimer);
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
    }

    peers.forEach((pc, clientId) => {
      pc.close();
      peers.delete(clientId);
    });

    electronAPI.log('[CAPTURE] Video engine completely stopped and peers cleared.');
  }
});

// --- WebRTC Host Signaling ---

/**
 * @param {string} clientId
 * @returns {RTCPeerConnection}
 */
const createPeerConnection = (clientId) => {
  /** @type {RTCPeerConnection} */
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: hostIceServers }],
  });

  // GLITCH FIX 1: Attach video stream BEFORE creating the answer
  if (activeStream) {
    activeStream.getTracks().forEach((track) => {
      pc.addTrack(track, activeStream);
    });
    electronAPI.log(`[WEBRTC HOST] Video track attached for client [${clientId}].`);
  } else {
    electronAPI.error(`[WEBRTC HOST ERROR] No active stream available for client [${clientId}].`);
  }

  // GLITCH FIX 2: Listen for the DataChannel to capture Gamepad inputs
  pc.ondatachannel = (event) => {
    electronAPI.log(`[WEBRTC HOST] Gamepad DataChannel opened for client [${clientId}]!`);

    /** @type {RTCDataChannel} */
    const inputChannel = event.channel;

    // Envia o ClientId também pelo SDP manual usando o canal de dados
    inputChannel.send(JSON.stringify({ type: 'server_hello', clientId: clientId }));

    inputChannel.onmessage = (msg) => {
      /** @type {Object} */
      const gamepadData = JSON.parse(msg.data);

      // Se for Ping, rebate como Pong imediatamente sem passar pelo main.js
      if (gamepadData.type === 'ping') {
        inputChannel.send(JSON.stringify({ type: 'pong', time: gamepadData.time }));
        return;
      }

      // Se for inputs ou latência calculada, envia pro main.js
      gamepadData.clientId = clientId;
      electronAPI.sendGamepadInput(gamepadData);
    };
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      electronAPI.sendSignal({
        type: 'ice_candidate',
        candidate: event.candidate,
        clientId: clientId,
      });
    }
  };

  pc.onconnectionstatechange = () => {
    electronAPI.log(`[WEBRTC HOST] Status [${clientId}]: ${pc.connectionState}`);

    if (pc.connectionState === 'connected') {
      electronAPI.notifyClientConnected(clientId);
    }

    if (
      pc.connectionState === 'disconnected' ||
      pc.connectionState === 'failed' ||
      pc.connectionState === 'closed'
    ) {
      peers.delete(clientId);
      electronAPI.sendGamepadCleanup(clientId);
      electronAPI.notifyClientDisconnected(clientId);
    }
  };

  peers.set(clientId, pc);
  return pc;
};

/**
 * @param {RTCPeerConnection} peerConnection
 * @returns {Promise<void>}
 */
export const waitForIceGathering = (peerConnection) => {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      /**
       * @returns {void}
       */
      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      peerConnection.addEventListener('icegatheringstatechange', checkState);
    }
  });
};

electronAPI.onManualOffer(async (event, offerString) => {
  /** @type {string} */
  const clientId = `manual_${Date.now()}`;
  /** @type {RTCPeerConnection} */
  const pc = createPeerConnection(clientId);

  try {
    /** @type {RTCSessionDescriptionInit} */
    const remoteOffer = JSON.parse(offerString);
    await pc.setRemoteDescription(remoteOffer);

    /** @type {RTCSessionDescriptionInit} */
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    electronAPI.log(`[WEBRTC] Waiting for ICE candidates to finish gathering for [${clientId}]...`);
    await waitForIceGathering(pc);

    /** @type {string} */
    const answerString = JSON.stringify(pc.localDescription);
    electronAPI.sendManualAnswer(answerString);

    electronAPI.log(`[WEBRTC] Manual answer generated and dispatched for [${clientId}].`);
  } catch (error) {
    electronAPI.error(
      `[WEBRTC ERROR] Failed to process manual SDP offer for [${clientId}]:`,
      error,
    );
    peers.delete(clientId);
  }
});

electronAPI.onSignal(async (data) => {
  /** @type {string} */
  const clientId = data.clientId || 'ws_client';

  if (data.type === 'offer') {
    electronAPI.log(
      `[WEBRTC HOST] Remote offer received from [${clientId}]. Establishing connection...`,
    );

    /** @type {RTCPeerConnection} */
    const pc = createPeerConnection(clientId);

    // Fulfill the WebRTC handshake
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    /** @type {RTCSessionDescriptionInit} */
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    electronAPI.sendSignal({ type: 'answer', answer: answer, clientId: clientId });
  } else if (data.type === 'ice_candidate') {
    /** @type {RTCPeerConnection | undefined} */
    const pc = peers.get(clientId);

    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        electronAPI.error(`[WEBRTC HOST ERROR] Failed to add ICE candidate for [${clientId}]`, err);
      }
    }
  }
});

electronAPI.onForceCloseWebrtc((event, clientId) => {
  /** @type {RTCPeerConnection | undefined} */
  const pc = peers.get(clientId);
  if (pc) {
    pc.close();
    peers.delete(clientId);
    electronAPI.sendGamepadCleanup(clientId);
    electronAPI.notifyClientDisconnected(clientId);
    electronAPI.log(`[WEBRTC] Forcefully closed connection for [${clientId}]`);
  }
});
