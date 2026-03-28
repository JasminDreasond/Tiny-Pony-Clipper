# 🐴 Tiny Pony Stream - API Integration Guide

Welcome to the Tiny Pony Stream API documentation! This guide explains how third-party websites can programmatically send connection requests to the Tiny Pony Stream client using our secure API Bridge.

To ensure user privacy and security, direct communication with the main client (`index.html`) is isolated. Instead, we use a hidden iframe (`api.html`) that acts as a secure messenger between your website and the user's local stream client.

---

## 🏗️ Architecture Overview

The communication flows like this:
1. **Your Website** embeds `api.html` inside a hidden `iframe`.
2. **Your Website** sends a `postMessage` to the `iframe`.
3. The **API Bridge (`api.html`)** validates the origin and relays the message via a **Service Worker**.
4. The **Main Client (`index.html`)** receives the request, asks the user for permission (if it's their first time), and executes the connection.
5. A response is routed back to **Your Website** with the result.

---

## 🔒 Security Requirements

Before you begin, please note our strict security policies:
* **HTTPS Only:** The API will outright reject requests originating from non-secure `http://` pages (with exceptions for `localhost` and `127.0.0.1` during development).
* **Rate Limiting:** Do not spam connection requests. There is a strict cooldown of 1.5 seconds between requests. Spamming will result in an `ERR_RATE_LIMIT` rejection.
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

### Step 3: Send a Connection Request
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

### Step 4: Handle the Response
Listen for the `tiny_pony_api_response` event to know if the connection succeeded, was denied, or encountered an error.

```javascript
window.addEventListener('message', (event) => {
  const data = event.data;
  
  if (data && data.type === 'tiny_pony_api_response') {
    console.log(`Response for request ${data.requestId}:`, data.status);
    
    if (data.status === 'success') {
      console.log('Successfully connected! Have fun!');
      // Update your UI accordingly
    } else {
      console.error(`Connection failed [${data.code}]:`, data.message);
      // Handle errors (e.g., ERR_DENIED, ERR_BUSY, ERR_INSECURE_ORIGIN)
    }
  }
});
```

---

## 🛑 Status Error Codes Reference

Here is a list of error codes you might receive in the `data.code` property:

| Error Code | Description |
| :--- | :--- |
| `SUCCESS_CONNECTED` | The user accepted, and the connection was initiated successfully. |
| `ERR_INSECURE_ORIGIN` | Your website is not using HTTPS. The request was killed instantly. |
| `ERR_DENIED` | The user explicitly clicked "Deny" on the permission modal. |
| `ERR_BLOCKED` | The user has permanently blocked your website in their API Manager. |
| `ERR_TIMEOUT` | The user ignored the permission modal for over 30 seconds. |
| `ERR_BUSY` | The client is already in a game or currently processing another prompt. |
| `ERR_RATE_LIMIT` | You are sending requests too quickly. Wait 1.5s between calls. |
| `ERR_INVALID_PAYLOAD`| The data sent did not pass Regex validation (e.g., invalid Base64 or invalid IP format). |

---
**Happy Streaming!** 🎮
