/** @type {HTMLInputElement} */
const targetUrlInput = document.getElementById('targetUrl');
/** @type {HTMLInputElement} */
const hostIpInput = document.getElementById('hostIp');
/** @type {HTMLInputElement} */
const hostPassInput = document.getElementById('hostPass');
/** @type {HTMLButtonElement} */
const btnSend = document.getElementById('btnSend');
/** @type {HTMLElement} */
const iframeContainer = document.getElementById('iframeContainer');

/**
 * @param {string} baseUrl
 * @returns {Promise<HTMLIFrameElement>}
 */
const loadApiIframe = (baseUrl) => {
  return new Promise((resolve) => {
    /** @type {HTMLIFrameElement} */
    const iframe = document.createElement('iframe');
    iframe.src = `${baseUrl}/api.html`;

    iframe.onload = () => resolve(iframe);

    iframeContainer.innerHTML = '';
    iframeContainer.appendChild(iframe);
  });
};

btnSend.addEventListener('click', async () => {
  /** @type {string} */
  const targetUrl = targetUrlInput.value.replace(/\/$/, '');
  /** @type {string} */
  const host = hostIpInput.value;
  /** @type {string} */
  const pass = hostPassInput.value;

  console.log(`[TEST APP] Loading iframe from ${targetUrl}...`);

  /** @type {HTMLIFrameElement} */
  const apiIframe = await loadApiIframe(targetUrl);

  /** @type {Object} */
  const payload = {
    action: 'connect_ip',
    host: host,
    pass: pass,
  };

  console.log('[TEST APP] Sending message to iframe:', payload);

  if (apiIframe.contentWindow) {
    apiIframe.contentWindow.postMessage(payload, targetUrl);
  }
});
