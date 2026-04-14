# 🐎 Tiny Pony Clipper - CLI Integration Guide

*The Command Line Interface (CLI) is fully implemented and available since version 1.1.5. Remote Client Control added in version 1.2.0.*

Welcome to the Tiny Pony Clipper CLI documentation! If you are developing a third-party application, a launcher, or a custom script, you can use our built-in CLI to securely communicate with the Tiny Pony Clipper engine and its local client.

The CLI allows you to start the background engine with custom configuration overrides, forcefully shut down the server, safely exchange WebRTC SDP payloads, and actively control the local Remote Play Client window—all without requiring the user to navigate the graphical interface manually.

---

## 🛡️ Security & Firewall Notice

Tiny Pony Clipper takes user security very seriously. To prevent malicious scripts from hijacking the background clipping engine or establishing unauthorized Remote Play connections, **every third-party application that attempts to use this CLI must be explicitly authorized by the user.**

When your application sends its first CLI command, Tiny Pony Clipper will pause the execution and display a secure graphical prompt to the user asking for permission. If the user clicks "Allow", your application's executable path will be safely registered in a root-protected firewall whitelist, and all future CLI commands will run instantly.

*(Note: Internal CLI commands targeting the client window will clearly identify as coming from the "Local System (CLI)" to reassure users).*

---

## 🛠️ Available Commands

You can append these arguments when launching the `tiny-pony-clipper` executable from your terminal or child process.

### Core Server Commands
* `--help`: Displays the list of available commands directly in the terminal output.
* `--process-sdp [base64]`: Sends a Base64-encoded SDP Offer to the WebRTC Server engine (Host mode). The CLI will wait for the ICE gathering to finish and return a JSON containing the Base64-encoded SDP Answer.
* `--exit` (or `exit`): Safely closes the Tiny Pony Clipper application and shuts down the background socket servers. If used on the very first startup, it will kill the process immediately without spawning windows.

### Local Client Control Commands
*Use these commands to remotely control the active Tiny Pony Stream client window running on the local machine.*

* `--client-status`: Checks if the local Remote Play Client is currently actively playing in a session.
* `--client-offer`: Generates a WebRTC Offer directly from the local Remote Play Client.
* `--client-connect-ip [ip] [pass]`: Forces the local Remote Play Client to connect to a specific Host server via IP.
* `--client-connect-sdp [base64]`: Forces the local Remote Play Client to apply a Server Answer via manual SDP.

**Optional Client Media Flags:**
When using `--client-connect-ip` or `--client-connect-sdp`, you can append these optional flags to force the client to enable/disable specific features, bypassing the user's saved UI preferences:
* `--video [true/false]`: Enables or disables the incoming video feed.
* `--audio [true/false]`: Enables or disables the incoming audio feed.
* `--kbpad [true/false]`: Enables or disables the virtual keyboard gamepad.
*(Example: `--client-connect-ip 192.168.1.10:8080 mypass --video false --kbpad true`)*

### Configuration Overrides
*Using these flags will temporarily override the user's saved JSON settings for that specific server session.*

* `--force-stream [true/false]`: Forces the Remote Play WebRTC server to start upon initialization, even if the user disabled it in the UI.
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
