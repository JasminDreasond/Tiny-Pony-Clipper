/** @type {MediaRecorder | null} */
let mediaRecorder = null;

/** @type {number} */
let currentTimestamp = 0;

/** @type {NodeJS.Timeout | null} */
let segmentTimer = null;

/** @type {MediaStream | null} */
let activeStream = null;

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
      /** @type {MediaStream} */
      const rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      });

      activeStream = rawStream;

      electronAPI.log(`[CAPTURE] Video engine started: @ 60fps`);
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
