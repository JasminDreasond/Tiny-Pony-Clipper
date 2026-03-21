/** @type {MediaRecorder | null} */
let mediaRecorder = null;

window.electronAPI.onCaptureCommand(async (data) => {
  if (data.action === 'start') {
    /** @type {Object} */
    const config = data.config;
    /** @type {Object} */
    const bounds = data.bounds;

    try {
      /** @type {MediaStream} */
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: bounds.width },
          height: { ideal: bounds.height },
          frameRate: { ideal: 60, max: 60 },
        },
      });

      /** @type {Object} */
      let options = { mimeType: 'video/webm; codecs=h264', videoBitsPerSecond: 15000000 };

      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.warn('[CAPTURE WARN] H264 not supported. Falling back to VP8.');
        options = { mimeType: 'video/webm; codecs=vp8', videoBitsPerSecond: 15000000 };
      }

      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          /** @type {ArrayBuffer} */
          const buffer = await e.data.arrayBuffer();
          window.electronAPI.sendVideoChunk(buffer);
        }
      };

      mediaRecorder.start(100);
      console.log(`[CAPTURE] WebRTC Stream started: ${bounds.width}x${bounds.height} @ 60fps`);

      stream.getVideoTracks()[0].onended = () => {
        console.log('[CAPTURE] Wayland stream ended by user.');
      };
    } catch (error) {
      console.error('[CAPTURE ERROR] Wayland Portal denied or failed.', error);
    }
  } else if (data.action === 'stop') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      console.log('[CAPTURE] WebRTC Stream stopped.');
    }
  }
});
