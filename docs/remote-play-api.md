# 🔌 Tiny Pony Clipper - Remote Play API Documentation

Tiny Pony Clipper provides a built-in WebSocket and WebRTC server. This allows developers to build custom clients (using any programming language or engine that supports WebSockets and WebRTC) to receive low-latency audio/video streams and send remote gamepad inputs.

## 🏗️ Architecture Overview

The connection works in two layers:
1. **WebSocket Layer (Signaling & Auth):** Used strictly to authenticate the client and exchange WebRTC SDP (Session Description Protocol) and ICE candidates.
2. **WebRTC Layer (Media & Data):** A peer-to-peer connection that streams the host's screen/audio (if enabled) and opens a `DataChannel` to receive rapid gamepad inputs with zero network overhead.

---

## 1. WebSocket Signaling Protocol

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
  "iceServers": "stun:stun.l.google.com:19302"
}
```
* `enableVideo`: If `false`, the host has disabled the video engine to save bandwidth. The client should not expect a video track.
* `iceServers`: A comma-separated string of STUN/TURN servers configured by the host. The client should use these to configure its `RTCPeerConnection`.

**Server Response (Failure):**
```json
{
  "type": "auth_error"
}
```
*(The server will immediately close the socket after sending this).*

### Phase 2: WebRTC Handshake (Signaling)

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

### Server Warnings

The server may broadcast warnings over the WebSocket (for example, if a client tries to connect more gamepads than the host's limit).
```json
{
  "type": "server_warning",
  "message": "Gamepad [4] blocked: Server max limit of 4 reached."
}
```

---

## 2. WebRTC DataChannel (Gamepad Inputs)

Once the WebRTC `RTCPeerConnection` is established, the client must create an `RTCDataChannel` to transmit gamepad data. 

* **Channel Configuration:** For minimal latency, the DataChannel should be created with `{ ordered: false, maxRetransmits: 0 }`.
* **Polling Rate:** It is recommended to send input data every animation frame (approx. 60 times per second) only for connected/active pads.

### Sending Inputs

Send stringified JSON messages through the DataChannel.

**Payload Format:**
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

### Data Structure Rules
* **`index`:** The integer ID of the controller. Must be between `0` and the host's configured maximum (e.g., `11` for 12 players).
* **`buttons`:** An array of objects. Standard mapping expects 16+ buttons (A, B, X, Y, Bumpers, Triggers, D-Pad, etc.).
* **`axes`:** An array of numbers ranging from `-1.0` to `1.0`. Standard mapping expects 4 axes (Left Stick X, Left Stick Y, Right Stick X, Right Stick Y).

### Receiving Force Feedback (Rumble)

The host can send vibration events back to the client via the same DataChannel. Your client should listen for `onmessage` events.

**Server Sends Vibration:**
```json
{
  "type": "vibration",
  "index": 0,
  "duration": 200,
  "weak": 0.5,
  "strong": 0.8
}
```
