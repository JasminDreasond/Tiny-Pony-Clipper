/** @type {MediaRecorder | null} */
let mediaRecorder = null;

/** @type {number} */
let currentSegment = 0;

/** @type {NodeJS.Timeout | null} */
let segmentTimer = null;

/** @type {MediaStream | null} */
let activeStream = null;

/**
 * @param {string} deviceId
 * @param {boolean} isMic
 * @returns {Promise<MediaStream | null>}
 */
const getAudioStream = async (deviceId, isMic) => {
  if (!deviceId || deviceId === 'none') return null;
  try {
    /** @type {Object} */
    const constraints = {
      audio: {
        deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
        echoCancellation: isMic,
        noiseSuppression: isMic,
        autoGainControl: isMic,
      },
    };
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    console.error('[CAPTURE ERROR] Failed to capture audio device:', deviceId, e);
    return null;
  }
};

/**
 * @param {MediaStream} videoStream
 * @param {Object} config
 * @returns {Promise<MediaStream>}
 */
const setupAudioMixer = async (videoStream, config) => {
  try {
    /** @type {AudioContext} */
    const audioCtx = new AudioContext();

    /** @type {MediaStreamAudioDestinationNode} */
    const dest = audioCtx.createMediaStreamDestination();

    /** @type {boolean} */
    let hasAudio = false;

    electronAPI.log(`[CAPTURE] Selected sysInput`, config.sysInput);
    if (config.sysInput !== 'none') {
      const sysStream = await getAudioStream(config.sysInput, false);
      if (sysStream && sysStream.getAudioTracks().length > 0) {
        electronAPI.log(`[CAPTURE] System Audio Length:`, sysStream.getAudioTracks().length);
        audioCtx.createMediaStreamSource(sysStream).connect(dest);
        hasAudio = true;
      }
    }

    if (config.micInput !== 'none') {
      electronAPI.log(`[CAPTURE] Selected micInput`, config.micInput);
      /** @type {MediaStream | null} */
      const micStream = await getAudioStream(config.micInput, true);
      if (micStream && micStream.getAudioTracks().length > 0) {
        electronAPI.log(`[CAPTURE] Mic Audio Length:`, micStream.getAudioTracks().length);
        audioCtx.createMediaStreamSource(micStream).connect(dest);
        hasAudio = true;
      }
    }

    if (hasAudio) {
      const streamAudios = dest.stream.getAudioTracks();
      const streamVideos = videoStream.getVideoTracks();
      electronAPI.log(`[CAPTURE] Stream Audio Length:`, streamAudios.length);
      electronAPI.log(`[CAPTURE] Stream Video Length:`, streamVideos.length);
      return new MediaStream([streamVideos[0], streamAudios[0]]);
    }
  } catch (error) {
    console.warn('[CAPTURE WARN] Audio mixer failed, using video only.', error);
  }

  const streamVideos = videoStream.getVideoTracks();
  electronAPI.log(`[CAPTURE] Stream Video Length:`, streamVideos.length);
  return new MediaStream([streamVideos[0]]);
};

/**
 * @param {MediaStream} stream
 * @returns {void}
 */
const recordSegment = (stream) => {
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
        segmentIndex: currentSegment,
      });
    }
  };

  mediaRecorder.start(1000);

  segmentTimer = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      currentSegment++;
      recordSegment(stream);
    }
  }, 60000);
};

window.electronAPI.onCaptureCommand(async (data) => {
  if (data.action === 'start') {
    /** @type {Object} */
    const config = data.config;

    currentSegment = 0;

    try {
      /** @type {MediaStream} */
      const rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 60, max: 60 },
        },
        audio: true,
      });

      activeStream = await setupAudioMixer(rawStream, config);

      electronAPI.log(`[CAPTURE] Engine started: @ 60fps`);
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
    electronAPI.log('[CAPTURE] Engine completely stopped.');
  }
});
