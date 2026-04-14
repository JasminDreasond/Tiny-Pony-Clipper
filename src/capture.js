/** @type {MediaRecorder | null} */
let mediaRecorder = null;

/** @type {number} */
let currentTimestamp = 0;

/** @type {NodeJS.Timeout | null} */
let segmentTimer = null;

/** @type {MediaStream | null} */
let activeStream = null;

/** @type {number} */
let currentMaxBitrate = 15000000;

/** @type {string} */
let currentDegradationPreference = 'maintain-framerate';

/** @type {Map<string, RTCPeerConnection>} */
const peers = new Map();

/** @type {Map<string, RTCDataChannel>} */
const dataChannels = new Map();

/** @type {string[]} */
let hostIceServers = ['stun:stun.l.google.com:19302'];

/**
 * Attempts to find the correct WebRTC deviceId for the system audio.
 * Maps the OS audio string to a Chrome device label if possible,
 * prioritizing "Monitor" devices on Linux for desktop audio capture.
 *
 * @param {string} ffmpegInput - The OS/FFMPEG device string (e.g., 'default').
 * @returns {Promise<string | undefined>} The WebRTC deviceId, or undefined if not found.
 */
const getChromeAudioDeviceId = async (ffmpegInput) => {
  try {
    /** @type {MediaDeviceInfo[]} */
    const devices = await navigator.mediaDevices.enumerateDevices();
    /** @type {MediaDeviceInfo[]} */
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');

    electronAPI.log(
      '[WEBRTC AUDIO] Available Chrome Audio Inputs:',
      audioInputs.map((d) => d.label),
    );

    // 1. Try to find a loopback/monitor device for system audio (Standard Linux behavior)
    let targetDevice = audioInputs.find((d) => d.label.toLowerCase().includes('monitor'));

    // 2. If not found, try a basic heuristic match against the FFMPEG input name
    if (!targetDevice && ffmpegInput !== 'default') {
      targetDevice = audioInputs.find((d) =>
        d.label.toLowerCase().includes(ffmpegInput.toLowerCase()),
      );
    }

    if (targetDevice) {
      electronAPI.log(`[WEBRTC AUDIO] Matched Chrome device: ${targetDevice.label}`);
      return targetDevice.deviceId;
    }

    electronAPI.log('[WEBRTC AUDIO] No specific Chrome device mapped. Falling back to default.');
    return undefined;
  } catch (err) {
    electronAPI.error('[WEBRTC AUDIO ERROR] Failed to enumerate Chrome devices:', err);
    return undefined;
  }
};

/**
 * Starts recording a specific media stream segment, saving data chunks and restarting automatically
 * after a fixed duration to create manageable pieces for later assembly.
 *
 * @param {MediaStream} stream - The combined audio and video stream to record.
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
      currentMaxBitrate = data.streamMaxBitrate ?? 15000000;
      currentDegradationPreference = data.streamDegradation ?? 'maintain-framerate';

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
        audio: data.streamEnabled
          ? {
              suppressLocalAudioPlayback: false,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : false,
      });

      // --- LINUX/WAYLAND AUDIO GLITCH FIX ---
      /**
       * Checks if the Wayland portal failed to attach an audio track despite our request.
       * If true, triggers a fallback using standard getUserMedia with the mapped Chrome Device ID.
       */
      if (data.streamEnabled && rawStream.getAudioTracks().length === 0) {
        electronAPI.log(
          '[CAPTURE WARN] getDisplayMedia returned no audio track. Attempting fallback capture...',
        );
        try {
          /** @type {string | undefined} */
          const chromeDeviceId = await getChromeAudioDeviceId(data.sysInput);

          /** @type {MediaStreamConstraints} */
          const audioConstraints = {
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false,
          };

          if (chromeDeviceId) {
            audioConstraints.audio.deviceId = { exact: chromeDeviceId };
          }

          /** @type {MediaStream} */
          const fallbackAudio = await navigator.mediaDevices.getUserMedia(audioConstraints);

          fallbackAudio.getAudioTracks().forEach((track) => {
            rawStream.addTrack(track);
          });

          electronAPI.log('[CAPTURE] Fallback audio track successfully attached to active stream.');
        } catch (audioErr) {
          electronAPI.error('[CAPTURE ERROR] Fallback audio capture failed:', audioErr);
        }
      }
      // --------------------------------------

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
 * Initializes a new WebRTC Peer Connection for a specific client, attaches the active video stream,
 * and configures data channels for remote gamepad inputs.
 *
 * @param {string} clientId - The unique identifier for the connecting client.
 * @returns {RTCPeerConnection} The fully configured WebRTC Peer Connection object.
 */
const createPeerConnection = (clientId) => {
  /** @type {RTCPeerConnection} */
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: hostIceServers }],
  });

  // GLITCH FIX 1: Attach video stream BEFORE creating the answer
  if (activeStream) {
    activeStream.getTracks().forEach((track) => {
      /** @type {RTCRtpSender} */
      const sender = pc.addTrack(track, activeStream);

      if (track.kind === 'video') {
        /** @type {RTCRtpSendParameters} */
        const parameters = sender.getParameters();

        if (!parameters.encodings) {
          parameters.encodings = [{}];
        }

        // Sets how the WebRTC engine handles network drops
        parameters.degradationPreference = currentDegradationPreference;

        // Hard limits the WebRTC max bitrate transmission
        parameters.encodings[0].maxBitrate = currentMaxBitrate;

        sender.setParameters(parameters).catch((err) => {
          electronAPI.error('[WEBRTC] Failed to set video parameters:', err);
        });
      }
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

    // Saves the data channel so we can send messages from main.js
    dataChannels.set(clientId, inputChannel);

    // Also sends the ClientId via manual SDP using the data channel
    inputChannel.send(JSON.stringify({ type: 'server_hello', clientId: clientId }));

    inputChannel.onmessage = (msg) => {
      /** @type {Object} */
      const data = JSON.parse(msg.data);

      // If it's a Ping, replies as Pong immediately without passing through main.js
      if (data.type === 'ping') {
        inputChannel.send(JSON.stringify({ type: 'pong', time: data.time }));
        return;
      }

      // If it's inputs or calculated latency, sends it to main.js
      data.clientId = clientId;
      electronAPI.sendGamepadInput(data);
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
      dataChannels.delete(clientId);
      electronAPI.sendGamepadCleanup(clientId);
      electronAPI.notifyClientDisconnected(clientId);
    }
  };

  peers.set(clientId, pc);
  return pc;
};

/**
 * Waits for the WebRTC ICE gathering process to complete before resolving.
 * Used primarily to generate complete manual SDP offers/answers.
 *
 * @param {RTCPeerConnection} peerConnection - The peer connection gathering ICE candidates.
 * @returns {Promise<void>} Resolves when the ICE gathering state becomes 'complete'.
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

electronAPI.onManualOffer(async (event, payload) => {
  /** @type {string} */
  let offerString;
  /** @type {string | undefined} */
  let requestId;

  if (typeof payload === 'string') {
    offerString = payload;
  } else {
    offerString = payload.offerString;
    requestId = payload.requestId;
  }

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
    electronAPI.sendManualAnswer({ answerString, requestId });

    electronAPI.log(`[WEBRTC] Manual answer generated and dispatched for [${clientId}].`);
  } catch (error) {
    electronAPI.error(
      `[WEBRTC ERROR] Failed to process manual SDP offer for [${clientId}]:`,
      error,
    );
    peers.delete(clientId);

    if (requestId) {
      electronAPI.sendManualAnswer({ answerString: null, requestId });
    }
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

    // Apply remote offer
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
  /** @type {RTCDataChannel | undefined} */
  const dc = dataChannels.get(clientId);

  // Sends the warning message via P2P before killing the connection
  if (dc && dc.readyState === 'open') {
    dc.send(
      JSON.stringify({ type: 'server_warning', message: 'You have been kicked by the host.' }),
    );
  }

  // Gives a small 250ms delay to ensure the message traveled through the network before cutting the connection
  setTimeout(() => {
    /** @type {RTCPeerConnection | undefined} */
    const pc = peers.get(clientId);
    if (pc) {
      pc.close();
      peers.delete(clientId);
      dataChannels.delete(clientId);
      electronAPI.sendGamepadCleanup(clientId);
      electronAPI.notifyClientDisconnected(clientId);
      electronAPI.log(`[WEBRTC] Forcefully closed connection for [${clientId}]`);
    }
  }, 250);
});

electronAPI.onSendDatachannelMessage((event, data) => {
  /** @type {RTCDataChannel | undefined} */
  const dc = dataChannels.get(data.clientId);
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify(data.payload));
  }
});
