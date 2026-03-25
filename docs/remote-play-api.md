# 🔌 Tiny Pony Clipper - Remote Play API Documentation

Tiny Pony Clipper provides a built-in WebSocket and WebRTC server. This allows developers to build custom clients (using any programming language or engine that supports WebSockets and WebRTC) to receive low-latency audio/video streams and send remote gamepad inputs.

## 🏗️ Architecture Overview

The connection works in two layers depending on how the client connects:
1. **Signaling Layer:** - **WebSocket Mode:** Used to authenticate the client and exchange WebRTC SDP (Session Description Protocol) and ICE candidates automatically over a local network or VPN.
   - **Manual Mode (Base64):** Used for pure P2P connections over the internet where WebSockets are unavailable. SDP offers and answers are exchanged manually via encoded strings.
2. **WebRTC Layer (Media & Data):** A peer-to-peer connection that streams the host's screen/audio (if enabled) and opens a `DataChannel` to receive rapid gamepad inputs, measure latency, and push server events with zero network overhead.

---

## 1. WebSocket Signaling Protocol (Automated)

**Endpoint:** `ws://<HOST_IP>:<PORT>`
*(The port is defined in the host's Tiny Pony Clipper settings, default is `8080`)*

### Phase 1: Authentication

Immediately after connecting to the WebSocket, the client **must** send an authentication payload.

**Client Request:**
```json
{
  "type": "auth",
  "password": "your_password_here"
}
```

**Server Response (Success):**
```json
{
  "type": "auth_success",
  "enableVideo": true,
  "iceServers": "stun:stun.l.google.com:19302",
  "clientId": "ip_1740000000_123"
}
```
* `enableVideo`: If `false`, the host has disabled the video engine to save bandwidth. The client should not expect a video track.
* `iceServers`: A comma-separated string of STUN/TURN servers configured by the host. The client should use these to configure its `RTCPeerConnection`.
* `clientId`: A unique session identifier assigned by the server.

**Server Response (Failure):**
```json
{
  "type": "auth_error"
}
```
*(The server will immediately close the socket after sending this).*

### Phase 2: WebRTC Handshake

Tiny Pony Clipper expects the **Client** to act as the initiator. After receiving `auth_success`, the client must create an Offer.

**Client Sends Offer:**
```json
{
  "type": "offer",
  "offer": { "type": "offer", "sdp": "..." }
}
```

**Server Replies with Answer:**
```json
{
  "type": "answer",
  "answer": { "type": "answer", "sdp": "..." }
}
```

**Exchanging ICE Candidates (Bidirectional):**
Both client and server will send their ICE candidates using this format:
```json
{
  "type": "ice_candidate",
  "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 }
}
```

---

## 2. Manual SDP Signaling Protocol (Base64)

For connections outside the local network without port forwarding, users can manually exchange WebRTC data.

1. **Client Generation:** The client creates a WebRTC Offer, waits for ICE candidate gathering to complete, stringifies the JSON, encodes it in **Base64**, and sends it to the host via any text messenger.
2. **Server Answer:** The host inputs the Base64 string into Tiny Pony Clipper. The server decodes it, generates an Answer (also waits for ICE), encodes the Answer in **Base64**, and provides it to the host to send back.
3. **Client Connection:** The client decodes the Base64 Answer, applies it as the `RemoteDescription`, and the P2P connection is established.

---

## 3. WebRTC DataChannel (Inputs & Telemetry)

Once the WebRTC `RTCPeerConnection` is established, the client must create an `RTCDataChannel` named `"gamepad"` to transmit data and receive server events. 

* **Channel Configuration:** For minimal latency, the DataChannel should be created with `{ ordered: false, maxRetransmits: 0 }`.

### ➡️ Client to Server Messages

Send stringified JSON messages through the DataChannel.

**1. Sending Inputs (`multi_input`)**
*(Recommended: Send every animation frame, approx. 60 times per second, only for active pads).*
```json
{
  "type": "multi_input",
  "pads": [
    {
      "index": 0,
      "buttons": [
        { "pressed": true, "value": 1.0 },
        { "pressed": false, "value": 0.0 }
      ],
      "axes": [ 0.0, -1.0, 0.5, 0.0 ]
    }
  ]
}
```

Data Structure Rules

* **`index`:** The integer ID of the controller. Must be between `0` and the host's configured maximum (e.g., `11` for 12 players).
* **`buttons`:** An array of objects. Standard mapping expects 16+ buttons (A, B, X, Y, Bumpers, Triggers, D-Pad, etc.).
* **`axes`:** An array of numbers ranging from `-1.0` to `1.0`. Standard mapping expects 4 axes (Left Stick X, Left Stick Y, Right Stick X, Right Stick Y).

**2. Network Latency Check (`ping`)**
*(Recommended: Send every 2 seconds).*
```json
{
  "type": "ping",
  "time": 1740000000000
}
```

**3. Reporting Latency (`client_latency`)**
*(Sent to the server after calculating the difference between a `pong` response and the current time, allowing the host dashboard to display the user's ping).*
```json
{
  "type": "client_latency",
  "latency": 45
}
```

### ⬅️ Server to Client Messages

Listen to the DataChannel's `onmessage` event to handle data coming from the host.

**1. Server Identification (`server_hello`)**
*(Sent immediately when the DataChannel opens).*
```json
{
  "type": "server_hello",
  "clientId": "ip_1740000000_123"
}
```

**2. Ping Rebound (`pong`)**
*(Rebounds the exact timestamp sent by the client's `ping`).*
```json
{
  "type": "pong",
  "time": 1740000000000
}
```

**3. Force Feedback (`vibration`)**
*(Triggers controller rumble).*
```json
{
  "type": "vibration",
  "index": 0,
  "duration": 200,
  "weak": 0.5,
  "strong": 0.8
}
```

**4. Server Warnings (`server_warning`)**
*(Broadcasted if the host kicks the client, or if the client tries to connect more gamepads than the server's maximum limit).*
```json
{
  "type": "server_warning",
  "message": "You have been kicked by the host."
}
```
*(Note: For IP clients, warnings may also arrive via the WebSocket layer).*
