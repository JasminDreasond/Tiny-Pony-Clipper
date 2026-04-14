# 🐴 Tiny Pony Stream - API Integration Guide

*The Web API is fully implemented and available since version 1.1.5. Media configuration flags added in 1.2.0.*

Welcome to the Tiny Pony Stream API documentation! This guide explains how third-party websites can programmatically send connection requests and check client status using our secure API Bridge.

To ensure user privacy and prevent data interception, direct communication with the main client (`index.html`) is completely isolated. Instead, we establish a private hardware-level tunnel (`MessageChannel`) via a hidden iframe (`api.html`).

---

## 🏗️ Architecture Overview

The secure communication flow works as follows:
1. **Your Website** embeds `api.html` inside a hidden `iframe`.
2. The **API Bridge (`api.html`)** finishes loading and broadcasts a `tiny_pony_api_ready` signal.
3. **Your Website** creates a `MessageChannel` and sends one of the ports (`port2`) to the iframe to initialize the handshake.
4. The **API Bridge** verifies your origin and confirms the tunnel is open by sending `tiny_pony_api_ready` through the private port.
5. All subsequent requests and sensitive data are sent **exclusively through the private port**, bypassing the global window DOM entirely.
6. The **Main Client (`index.html`)** processes the request via Service Worker, prompts the user (if required), and returns the result through the tunnel.

---

## 🔒 Security Requirements

Before you begin, please note our strict security policies:
* **HTTPS Only:** The API will outright reject requests originating from non-secure `http://` pages (with exceptions for `localhost` and `127.0.0.1` during development).
* **Point-to-Point Tunneling:** You MUST use the `MessageChannel` API to communicate. Global `window.postMessage` payloads will be ignored to prevent interception by malicious browser extensions or cross-site scripts.
* **Rate Limiting:** Do not spam requests. There is a strict cooldown of 1.5 seconds between requests (status ping checks bypass this cooldown). Spamming will result in an `ERR_RATE_LIMIT` rejection.
* **Unique Requests:** Every payload must have a unique `requestId`. Reusing an ID that is currently being processed or was processed in the last 10 minutes will trigger an `ERR_DUPLICATE_REQUEST`.
* **User Consent:** The user always has the final say. Connection requests will trigger a modal on their client asking them to "Allow" or "Deny" your website.
* **Strict Validation:** Hosts and Base64 SDP strings are heavily sanitized and validated using Regex.

---

## 🚀 How to Implement

### Step 1: Embed the Bridge iframe
Add the `api.html` iframe to your website's HTML. Make sure it points to the domain where the Tiny Pony Stream client is hosted.

```html
<iframe 
  id="tinyPonyApiBridge" 
  src="https://your-stream-client-domain.com/api.html" 
  style="display: none;">
</iframe>
```

### Step 2: Establish the Secure Tunnel
Wait for the iframe to load, then create the `MessageChannel` to establish the private connection.

```javascript
/** @type {HTMLIFrameElement} */
const iframe = document.getElementById('tinyPonyApiBridge');
/** @type {MessageChannel} */
const channel = new MessageChannel();
/** @type {MessagePort} */
const apiPort = channel.port1;

/** @type {boolean} */
let isApiReady = false;

// 1. Listen for the iframe load event
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'tiny_pony_api_ready') {
    // 2. Initialize the secure handshake
    iframe.contentWindow.postMessage(
      { type: 'init_tiny_pony_api' }, 
      'https://your-stream-client-domain.com/api.html', 
      [channel.port2]
    );
  }
});

// 3. Listen on the private port for API responses
apiPort.onmessage = (event) => {
  const data = event.data;
  
  if (data && data.type === 'tiny_pony_api_ready') {
    console.log('Secure tunnel established! API is ready.');
    isApiReady = true;
  } else if (data && data.type === 'tiny_pony_api_response') {
    handleApiResponse(data);
  }
};
```

### Step 3: Send Requests
Once `isApiReady` is true, you can send payloads directly into `apiPort`. You must include a unique `requestId` to track the response.

#### Action: Ping (Check if client is open)
Silently checks if the user has the Tiny Pony main application tab open. Does not require user permission.
```javascript
apiPort.postMessage({
  action: 'ping',
  requestId: 'req_' + Date.now()
});
```

#### Action: Check Session Status
Silently checks if the user is currently playing a game. *Note: For privacy, this will only return successfully if the user has previously "Allowed" your website.*
```javascript
apiPort.postMessage({
  action: 'check_session_status',
  requestId: 'req_' + Date.now()
});
```

#### Action: Connect via IP Address
Prompts the user to connect to a specific server. You can optionally force media toggles to bypass the user's UI checkboxes.
```javascript
apiPort.postMessage({
  action: 'connect_ip',
  requestId: 'req_' + Date.now(),
  host: '192.168.1.10:8080', 
  pass: 'secret_password',
  // Optional configuration overrides:
  video: false, // Forces video feed OFF
  audio: true,  // Forces audio feed ON
  kbpad: true   // Forces Virtual Keyboard ON
});
```

#### Action: Connect via Manual SDP (Base64)
Prompts the user to apply a server WebRTC answer. Optional media overrides are also supported here.
```javascript
apiPort.postMessage({
  action: 'connect_sdp',
  requestId: 'req_' + Date.now(),
  answer: base64Answer, // The Base64 encoded WebRTC answer
  // Optional configuration overrides:
  video: true
});
```

#### Action: Generate an SDP Offer
Prompts the user to generate a WebRTC offer so your signaling server can respond.
```javascript
apiPort.postMessage({
  action: 'generate_offer',
  requestId: 'req_' + Date.now()
});
```

### Step 4: Handle the Responses
Process the responses arriving through `apiPort.onmessage`.

```javascript
/**
 * @param {Object} data
 */
const handleApiResponse = (data) => {
  console.log(`Response for request ${data.requestId}:`, data.status);
  
  if (data.status === 'success') {
    if (data.code === 'SUCCESS_OFFER_GENERATED') {
      console.log('Client generated an Offer:', data.data.offer);
    } else if (data.code === 'SUCCESS_CLIENT_ALIVE') {
      console.log('The client window is open!', data.data.alive);
    } else if (data.code === 'SUCCESS_STATUS_CHECKED') {
      console.log('Is user playing?', data.data.isPlaying);
    } else {
      console.log('Successfully connected! Have fun!');
    }
  } else {
    console.error(`Request failed [${data.code}]:`, data.message);
    // Handle errors (e.g., ERR_DENIED, ERR_NO_CLIENT, ERR_BUSY)
  }
};
```

---

## 🛑 Status Error Codes Reference

Here is a comprehensive list of status codes you might receive in the `data.code` property:

| Error Code | Description |
| :--- | :--- |
| `SUCCESS_CONNECTED` | The user accepted, and the connection was initiated successfully. |
| `SUCCESS_OFFER_GENERATED` | The user accepted, and the Base64 SDP offer is available in `r.data.offer`. |
| `SUCCESS_CLIENT_ALIVE` | Returned by `ping`. The user has the main streaming app open. |
| `SUCCESS_STATUS_CHECKED` | Returned by `check_session_status`. Contains `isPlaying` boolean in `data.data`. |
| `ERR_NO_CLIENT` | No active application window was found. The user must open the main streaming app first. |
| `ERR_INSECURE_ORIGIN` | Your website is not using HTTPS. The request was killed instantly. |
| `ERR_DUPLICATE_REQUEST` | The `requestId` sent is currently in use or was processed within the last 10 minutes. |
| `ERR_DENIED` | The user explicitly clicked "Deny" on the permission modal. |
| `ERR_BLOCKED` | The user has permanently blocked your website in their API Manager. |
| `ERR_TIMEOUT` | The user ignored the permission modal for over 30 seconds. |
| `ERR_BUSY` | The client is already in a game or currently processing another prompt. |
| `ERR_RATE_LIMIT` | You are sending requests too quickly. Wait 1.5s between calls. |
| `ERR_INVALID_PAYLOAD`| The data sent did not pass strict Regex validation (e.g., invalid Base64 or invalid IP format). |

---
**Happy Streaming!** 🎮
