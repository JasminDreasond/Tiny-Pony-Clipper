/**
 * Utility module to parse and modify WebRTC SDP strings for high-performance streaming.
 * It forces hardware codecs, sets bitrate limits, and upgrades audio to stereo.
 */

/**
 * Modifies the SDP string to enforce a specific maximum bitrate for video.
 *
 * @param {string} sdp - The original Session Description Protocol string.
 * @param {number} maxBitrateKbps - The maximum allowed bitrate in Kbps.
 * @returns {string} The modified SDP string.
 */
export const enforceVideoBitrate = (sdp, maxBitrateKbps) => {
  /**
   * @type {string[]}
   * Array of lines split from the original SDP string.
   */
  const lines = sdp.split('\r\n');

  /**
   * @type {number}
   * The index of the video media description line (m=video).
   */
  let videoIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('m=video')) {
      videoIndex = i;
      break;
    }
  }

  if (videoIndex === -1) return sdp;

  // Insert the bandwidth limitation line right after the m=video line
  lines.splice(videoIndex + 1, 0, `b=AS:${maxBitrateKbps}`);
  return lines.join('\r\n');
};

/**
 * Upgrades the Opus audio codec settings in the SDP to support high-bitrate stereo.
 * Disables features meant for voice calls (like DTX) to ensure raw game audio quality.
 *
 * @param {string} sdp - The original Session Description Protocol string.
 * @returns {string} The modified SDP string.
 */
export const enforceOpusStereo = (sdp) => {
  /**
   * @type {string[]}
   * Array of lines split from the original SDP string.
   */
  const lines = sdp.split('\r\n');

  /**
   * @type {string|null}
   * The payload type (PT) identifier for the Opus codec.
   */
  let opusPayloadType = null;

  // First, find the Opus payload type
  for (let i = 0; i < lines.length; i++) {
    /**
     * @type {RegExpMatchArray|null}
     * Regex match to find the rtpmap line for Opus.
     */
    const match = lines[i].match(/^a=rtpmap:(\d+) opus\/48000\/2/);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  if (!opusPayloadType) return sdp;

  // Now, find the fmtp line for this payload type and append our stereo/bitrate rules
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`a=fmtp:${opusPayloadType}`)) {
      lines[i] += '; stereo=1; sprop-stereo=1; maxaveragebitrate=512000; cbr=1; useinbandfec=1';
      return lines.join('\r\n');
    }
  }

  // If no fmtp line exists, create one
  lines.push(
    `a=fmtp:${opusPayloadType} stereo=1; sprop-stereo=1; maxaveragebitrate=512000; cbr=1; useinbandfec=1`,
  );
  return lines.join('\r\n');
};

/**
 * Prioritizes the H.264 video codec over VP8/VP9 by moving its payload types to the front.
 *
 * @param {string} sdp - The original Session Description Protocol string.
 * @returns {string} The modified SDP string.
 */
export const prioritizeH264 = (sdp) => {
  /**
   * @type {string[]}
   * Array of lines split from the original SDP string.
   */
  const lines = sdp.split('\r\n');

  /**
   * @type {number}
   * The index of the video media description line (m=video).
   */
  const mLineIndex = lines.findIndex((line) => line.startsWith('m=video'));

  if (mLineIndex === -1) return sdp;

  /**
   * @type {string[]}
   * Array to store the extracted H.264 payload types.
   */
  const h264PayloadTypes = [];

  // Find all H.264 payload types defined in rtpmap
  lines.forEach((line) => {
    /**
     * @type {RegExpMatchArray|null}
     * Regex match to find the rtpmap line for H264.
     */
    const match = line.match(/^a=rtpmap:(\d+) H264\/\d000/);
    if (match) {
      h264PayloadTypes.push(match[1]);
    }
  });

  if (h264PayloadTypes.length === 0) return sdp;

  /**
   * @type {string[]}
   * The original m=video line split by spaces.
   */
  const mLineParts = lines[mLineIndex].split(' ');

  /**
   * @type {string[]}
   * The base parts of the m=video line (e.g., "m=video 9 UDP/TLS/RTP/SAVPF").
   */
  const mLineHeader = mLineParts.slice(0, 3);

  /**
   * @type {string[]}
   * The current payload types listed in the m=video line.
   */
  const currentPayloadTypes = mLineParts.slice(3);

  /**
   * @type {string[]}
   * The new ordered array of payload types, with H.264 first.
   */
  const newPayloadTypes = [
    ...h264PayloadTypes,
    ...currentPayloadTypes.filter((pt) => !h264PayloadTypes.includes(pt)),
  ];

  lines[mLineIndex] = [...mLineHeader, ...newPayloadTypes].join(' ');
  return lines.join('\r\n');
};

/**
 * Applies all high-performance optimizations to an SDP string in one pass.
 *
 * @param {string} sdp - The original SDP string.
 * @param {number} [bitrateKbps=15000] - The target bitrate in Kbps.
 * @returns {string} The fully optimized SDP string.
 */
export const optimizeForGaming = (sdp, bitrateKbps = 15000) => {
  /**
   * @type {string}
   * The sequentially modified SDP string.
   */
  let optimizedSdp = sdp;
  optimizedSdp = prioritizeH264(optimizedSdp);
  optimizedSdp = enforceVideoBitrate(optimizedSdp, bitrateKbps);
  optimizedSdp = enforceOpusStereo(optimizedSdp);
  return optimizedSdp;
};
