### 🎮 Experimental Remote Play Server
Turn your PC into a remote multiplayer hub! We have implemented a new WebRTC-based server that allows you to receive Gamepad inputs directly from a web browser. 

* **Total Flexibility (Video On/Off):** You can stream both your gameplay video and audio directly through the web client. However, if you prefer using other software for screen sharing (like Discord or OBS) to save bandwidth, you can **disable the video stream** entirely! The client page will elegantly adapt into a "Gamepad Only" dashboard.
* **Up to 12 Players:** Bring everyone in! You can now configure the server to accept up to 12 simultaneous remote gamepads.
* **Save Bandwidth:** Turning off the video and audio engine leaves you with a pure, ultra-low latency input receiver.

### ⚙️ Settings & Control Upgrades
* **Custom Capture Frame Rate (FPS):** You now have total control over your recording! Set your desired capture frame rate directly in the settings (from 10 to 240 FPS, defaulting to a smooth 60 FPS).
* **Number Input Validation:** We added a strict JavaScript validation layer to all number inputs in the settings menu. This prevents accidental glitches, negative buffer times, or invalid port numbers, keeping your configuration safe and stable.

Tiny thanks for using Tiny Pony Clipper! 💖

**Full Changelog**: https://github.com/Pony-House/Tiny-Pony-Clipper/compare/1.0.0...1.1.0