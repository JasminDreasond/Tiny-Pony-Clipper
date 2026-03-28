self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', async (event) => {
  /** @type {Object} */
  const data = event.data;

  if (data && data.type === 'api_relay') {
    /** @type {Client[]} */
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    /** @type {Client | undefined} */
    const mainClient = windowClients.find(
      (c) => c.url.endsWith('/') || c.url.includes('index.html'),
    );

    if (mainClient) {
      mainClient.postMessage({
        type: 'api_request',
        origin: data.origin,
        payload: data.payload,
      });
    }
  }
});
