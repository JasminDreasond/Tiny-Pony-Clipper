/** @type {MediaRecorder | null} */
let mediaRecorder = null;

/** @type {number} */
let currentTimestamp = 0;

/** @type {NodeJS.Timeout | null} */
let segmentTimer = null;

/** @type {MediaStream | null} */
let activeStream = null;

/** @type {RTCPeerConnection | null} */
let peerConnection = null;

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

  window.electronAPI.startSegment(timestamp);

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
      window.electronAPI.sendVideoChunk({
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

window.electronAPI.onCaptureCommand(async (data) => {
  if (data.action === 'start') {
    try {
      const targetFps = data.frameRate ?? 60;

      if (data.iceServers) {
        /** @type {string[]} */
        const parsedUrls = data.iceServers
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
        if (parsedUrls.length > 0) hostIceServers = parsedUrls;
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
      electronAPI.log('[CAPTURE ERROR] Wayland Portal denied or failed.', error.message);
    }
  } else if (data.action === 'stop') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (segmentTimer) clearTimeout(segmentTimer);
    if (activeStream) {
      activeStream.getTracks().forEach((track) => track.stop());
    }
    electronAPI.log('[CAPTURE] Video engine completely stopped.');
  }
});

// --- WebRTC Host Signaling ---

window.electronAPI.onSignal(async (data) => {
  if (data.type === 'offer') {
    electronAPI.log('[WEBRTC HOST] Remote offer received. Establishing connection...');

    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: hostIceServers }],
    });

    // GLITCH FIX 1: Attach video stream BEFORE creating the answer
    if (activeStream) {
      activeStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, activeStream);
      });
      electronAPI.log('[WEBRTC HOST] Active video track attached to peer.');
    } else {
      electronAPI.error('[WEBRTC HOST ERROR] No active stream available to send!');
    }

    // GLITCH FIX 2: Listen for the DataChannel to capture Gamepad inputs
    peerConnection.ondatachannel = (event) => {
      electronAPI.log('[WEBRTC HOST] Gamepad DataChannel opened!');
      /** @type {RTCDataChannel} */
      const inputChannel = event.channel;

      inputChannel.onmessage = (msg) => {
        /** @type {Object} */
        const gamepadData = JSON.parse(msg.data);
        window.electronAPI.sendGamepadInput(gamepadData);
      };
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        window.electronAPI.sendSignal({
          type: 'ice_candidate',
          candidate: event.candidate,
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      electronAPI.log(`[WEBRTC HOST] Status: ${peerConnection.connectionState}`);
    };

    // Fulfill the WebRTC handshake
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

    /** @type {RTCSessionDescriptionInit} */
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    window.electronAPI.sendSignal({ type: 'answer', answer: answer });
  } else if (data.type === 'ice_candidate') {
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        electronAPI.error('[WEBRTC HOST ERROR] Failed to add ICE candidate', err);
      }
    }
  }
});
