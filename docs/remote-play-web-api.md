# 🐴 Tiny Pony Stream - API Integration Guide

*The Web API is fully implemented and available since version 1.1.5.*

Welcome to the Tiny Pony Stream API documentation! This guide explains how third-party websites can programmatically send connection requests to the Tiny Pony Stream client using our secure API Bridge.

To ensure user privacy and security, direct communication with the main client (`index.html`) is isolated. Instead, we use a hidden iframe (`api.html`) that acts as a secure messenger between your website and the user's local stream client.

---

## 🏗️ Architecture Overview

The communication flows like this:
1. **Your Website** embeds `api.html` inside a hidden `iframe`.
2. **Your Website** sends a `postMessage` to the `iframe`.
3. The **API Bridge (`api.html`)** validates the origin and relays the message via a **Service Worker**.
4. The **Main Client (`index.html`)** receives the request, asks the user for permission (if it's their first time), and executes the action.
5. A response is routed back to **Your Website** with the result.

---

## 🔒 Security Requirements

Before you begin, please note our strict security policies:
* **HTTPS Only:** The API will outright reject requests originating from non-secure `http://` pages (with exceptions for `localhost` and `127.0.0.1` during development).
* **Rate Limiting:** Do not spam requests. There is a strict cooldown of 1.5 seconds between requests. Spamming will result in an `ERR_RATE_LIMIT` rejection.
* **Unique Requests:** Every payload must have a unique `requestId`. Reusing an ID that is currently being processed will trigger an `ERR_DUPLICATE_REQUEST`.
* **User Consent:** The user always has the final say. When you send a request, a modal will appear on their client asking them to "Allow" or "Deny" your website.
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

### Step 2: Listen for the "Ready" Signal
Wait for the iframe to load and initialize its Service Worker before sending any commands.

```javascript
let isApiReady = false;

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'tiny_pony_api_ready') {
    console.log('Tiny Pony API is ready to receive commands!');
    isApiReady = true;
  }
});
```

### Step 3: Send a Request
Once ready, you can send a payload to the iframe. You must include a unique `requestId` to track the response.

#### Option A: Connect via IP Address
```javascript
const connectViaIP = () => {
  if (!isApiReady) return;

  const iframe = document.getElementById('tinyPonyApiBridge');
  
  const payload = {
    action: 'connect_ip',
    requestId: 'req_' + Date.now(), // Generate a unique ID
    host: '192.168.1.10:8080',      // The server IP/Host
    pass: 'secret_password'         // The room password
  };

  // Use '*' or the specific target origin for security
  iframe.contentWindow.postMessage(payload, '*'); 
};
```

#### Option B: Connect via Manual SDP (Base64)
```javascript
const connectViaSDP = (base64Answer) => {
  if (!isApiReady) return;

  const iframe = document.getElementById('tinyPonyApiBridge');
  
  const payload = {
    action: 'connect_sdp',
    requestId: 'req_' + Date.now(),
    answer: base64Answer // The Base64 encoded WebRTC answer
  };

  iframe.contentWindow.postMessage(payload, '*');
};
```

#### Option C: Generate an SDP Offer
If you need the client to generate a WebRTC offer so your server can respond with an answer, use this action.

```javascript
const requestOffer = () => {
  if (!isApiReady) return;

  const iframe = document.getElementById('tinyPonyApiBridge');
  
  const payload = {
    action: 'generate_offer',
    requestId: 'req_' + Date.now()
  };

  iframe.contentWindow.postMessage(payload, '*');
};
```

### Step 4: Handle the Response
Listen for the `tiny_pony_api_response` event to know if the connection succeeded, was denied, or if data was returned.

```javascript
window.addEventListener('message', (event) => {
  const data = event.data;
  
  if (data && data.type === 'tiny_pony_api_response') {
    console.log(`Response for request ${data.requestId}:`, data.status);
    
    if (data.status === 'success') {
      if (data.code === 'SUCCESS_OFFER_GENERATED') {
        console.log('Client generated an Offer:', data.data.offer);
        // Send this Base64 offer to your signaling server
      } else {
        console.log('Successfully connected! Have fun!');
      // Update your UI accordingly
      }
    } else {
      console.error(`Request failed [${data.code}]:`, data.message);
      // Handle errors (e.g., ERR_DENIED, ERR_NO_CLIENT, ERR_BUSY)
    }
  }
});
```

---

## 🛑 Status Error Codes Reference

Here is a comprehensive list of status codes you might receive in the `data.code` property:

| Error Code | Description |
| :--- | :--- |
| `SUCCESS_CONNECTED` | The user accepted, and the connection was initiated successfully. |
| `SUCCESS_OFFER_GENERATED` | The user accepted, and the Base64 SDP offer is available in `r.data.offer`. |
| `ERR_NO_CLIENT` | No active application window was found. The user must open the main streaming app first. |
| `ERR_INSECURE_ORIGIN` | Your website is not using HTTPS. The request was killed instantly. |
| `ERR_DUPLICATE_REQUEST` | The `requestId` sent is currently in use or was recently processed. |
| `ERR_DENIED` | The user explicitly clicked "Deny" on the permission modal. |
| `ERR_BLOCKED` | The user has permanently blocked your website in their API Manager. |
| `ERR_TIMEOUT` | The user ignored the permission modal for over 30 seconds. |
| `ERR_BUSY` | The client is already in a game or currently processing another prompt. |
| `ERR_RATE_LIMIT` | You are sending requests too quickly. Wait 1.5s between calls. |
| `ERR_INVALID_PAYLOAD`| The data sent did not pass strict Regex validation (e.g., invalid Base64 or invalid IP format). |

---
**Happy Streaming!** 🎮
