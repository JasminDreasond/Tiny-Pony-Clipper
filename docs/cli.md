# 🐎 Tiny Pony Clipper - CLI Integration Guide

*The Command Line Interface (CLI) is fully implemented and available since version 1.1.5.*

Welcome to the Tiny Pony Clipper CLI documentation! If you are developing a third-party application, a launcher, or a custom script, you can use our built-in CLI to securely communicate with the Tiny Pony Clipper engine. 

The CLI allows you to start the background engine with custom configuration overrides, forcefully shut down the server, and safely exchange WebRTC SDP payloads to establish Remote Play P2P connections without requiring the user to open the graphical interface.

---

## 🛡️ Security & Firewall Notice

Tiny Pony Clipper takes user security very seriously. To prevent malicious scripts from hijacking the background clipping engine or establishing unauthorized Remote Play connections, **every third-party application that attempts to use this CLI must be explicitly authorized by the user.**

When your application sends its first CLI command, Tiny Pony Clipper will pause the execution and display a secure graphical prompt to the user asking for permission. If the user clicks "Allow", your application's executable path will be safely registered in a root-protected firewall whitelist, and all future CLI commands will run instantly.

---

## 🛠️ Available Commands

You can append these arguments when launching the `tiny-pony-clipper` executable from your terminal or child process.

### Core Commands
* `--help`: Displays the list of available commands directly in the terminal output.
* `--process-sdp [base64]`: Sends a Base64-encoded SDP Offer to the WebRTC engine. The CLI will wait for the ICE gathering to finish and return a JSON containing the Base64-encoded SDP Answer.
* `--exit` (or `exit`): Safely closes the Tiny Pony Clipper application and shuts down the background socket servers.

### Configuration Overrides
*Using these flags will temporarily override the user's saved JSON settings for that specific session.*

* `--force-stream`: Forces the Remote Play WebRTC server to start upon initialization, even if the user disabled it in the UI.
* `--stream-port [port]`: Sets a custom local port for the internal WebSocket/HTTP server.
* `--stream-password [password]`: Sets a temporary access password for IP-based Remote Play connections.
* `--max-gamepads [number]`: Defines the maximum number of virtual gamepads the server will allow (0 to 12).
* `--ice-servers [urls]`: Overrides the default ICE routing servers (comma-separated URLs).
* `--enable-clipping [true/false]`: Enables or completely disables the background video/audio recording engine.
* `--stream-video-enabled [true/false]`: Enables or disables the video feed over WebRTC (useful if you only want to send gamepad inputs to save bandwidth).

---

## 💻 Integration Examples

The CLI always responds with a structured JSON string, making it extremely easy to parse in any programming language. 

### Processing an SDP Offer (Node.js Example)

If you are building an app in Node.js, you can easily interact with Tiny Pony Clipper using the `child_process` module:

```javascript
const { exec } = require('child_process');

// Your client's WebRTC Offer, encoded in Base64
const clientOfferBase64 = "eyd0eXBlJzogJ29mZmVyJywgJ3NkcCc6ICd2PTA... (truncated)";

exec(`tiny-pony-clipper --process-sdp ${clientOfferBase64}`, (error, stdout, stderr) => {
  if (error) {
    console.error("Execution failed:", error);
    return;
  }

  try {
    // The CLI outputs a clean JSON response
    const response = JSON.parse(stdout.trim());

    if (response.status === 'success') {
      console.log("Success! Here is the Server Answer (Base64):", response.data);
      // You can now send this answer back to your client
    } else {
      console.error("CLI Error:", response.error);
    }
  } catch (parseError) {
    console.error("Failed to parse CLI output:", stdout);
  }
});
```
