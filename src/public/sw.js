self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', async (event) => {
  /** @type {Object} */
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'api_relay') {
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
    } else {
      /** @type {Client[]} */
      const apiClients = windowClients.filter((c) => c.url.includes('api.html'));

      apiClients.forEach((client) => {
        client.postMessage({
          type: 'api_response',
          requestId: data.payload.requestId,
          origin: data.origin,
          status: 'error',
          code: 'ERR_NO_CLIENT',
          message: 'No active application window found. The user must open the app first.',
          data: null,
        });
      });
    }
  } else if (data.type === 'api_response') {
    /** @type {Client[]} */
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    windowClients.forEach((client) => {
      if (client.url.includes('api.html')) {
        client.postMessage(data);
      }
    });
  } else if (event.data && event.data.type === 'broadcast_kb_binds') {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        // Prevents sending the data back to the tab that just saved it
        if (client.id !== event.source.id) {
          client.postMessage({
            type: 'sync_kb_binds',
            binds: event.data.binds,
          });
        }
      });
    });
  }
});
