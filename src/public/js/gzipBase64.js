/**
 * Convert binary to Base64
 * @param {string} str
 * @returns {Promise<string>}
 */
export const compressToBase64 = async (str) => {
  /** @type {Uint8Array} */
  const byteArray = new TextEncoder().encode(str);

  /** @type {ReadableStream} */
  const cs = new CompressionStream('gzip');
  /** @type {WritableStream} */
  const writer = cs.writable.getWriter();

  writer.write(byteArray);
  writer.close();

  /** @type {ArrayBuffer} */
  const compressedBuffer = await new Response(cs.readable).arrayBuffer();

  //
  return btoa(String.fromCharCode(...new Uint8Array(compressedBuffer)));
};

/**
 * Convert Base64 to binary
 * @param {string} base64String
 * @returns {Promise<string>}
 */
export const decompressFromBase64 = async (base64String) => {
  /** @type {Uint8Array} */
  const compressedData = Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0));

  /** @type {DecompressionStream} */
  const ds = new DecompressionStream('gzip');

  /** @type {WritableStreamDefaultWriter} */
  const writer = ds.writable.getWriter();
  writer.write(compressedData);
  writer.close();

  /** @type {ArrayBuffer} */
  const decompressedBuffer = await new Response(ds.readable).arrayBuffer();

  /** @type {string} */
  return new TextDecoder().decode(decompressedBuffer);
};
