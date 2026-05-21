# Technical Report: Virtual Machine Detector

## Implementation Summary

The project implements a Node.js + Express server with a Vanilla JS frontend on port `9331`. Static assets are served from `app/public`; `/ping` supports fetch latency checks; `/ws` supports WebSocket RTT checks; `/inspect` exposes the server-side view of the HTTP request; `/report` logs explicit user-submitted reports to `scans.log`.

The detector is browser-only. It does not use plugins, desktop applications, native code, mandatory permissions, or local file reads. Unsupported and HTTP-restricted APIs are recorded gracefully.

The implementation combines calibrated VM scoring with an extended raw-inventory layer: WebGL/WebGPU dumps, server-visible headers, API availability matrix, media codec support, storage/crypto details, keyboard layout, speech voices, CSS/matchMedia support, and searchable raw data export.

The public GitHub Pages deployment uses `app/public` as a static artifact through `.github/workflows/pages.yml`. In that mode the browser-only scanner, hardware snapshot, raw inventory, and JSON exports remain available, while Express-only endpoints (`/report`, `/inspect`, `/ws`, `/ping`) are skipped or marked unavailable instead of contributing VM score.

## Implemented Detection Blocks

1. GPU / Rendering: WebGL and WebGL2 renderer/vendor strings, `WEBGL_debug_renderer_info`, VM keyword detection, WebGL limits, canvas fingerprint hash/length, WebGPU presence.
2. Hardware / CPU: `navigator.hardwareConcurrency`, empty-loop and `Math.sqrt` benchmarks, `performance.now()` precision, SharedArrayBuffer/Atomics probe, Web Worker throughput.
3. Memory: `performance.memory`, `navigator.deviceMemory`, typed-array allocation speed, Storage Estimate API.
4. Screen / Display: resolution, DPR, color depth, outer/inner/screen comparisons, available screen comparison, window screen origin.
5. Browser / Navigator: User-Agent VM/headless strings, platform/vendor/language/plugins/MIME types, `navigator.webdriver`, `pdfViewerEnabled`, UA Client Hints, platform/GPU consistency.
6. Peripheral APIs: Battery API, touch points, media device enumeration without permission prompts, Gamepad API, NetworkInformation, WebXR presence, Permissions API status probes.
7. Timezone / Locale: Intl timezone, navigator language ordering, Date vs Intl offset comparison, Intl.Collator benchmark.
8. Timing / Side-channel: `performance.now()` drift, `requestAnimationFrame` FPS, `setTimeout` jitter, AudioContext latency, CSS transition timing.
9. CSS / Rendering quirks: selected `CSS.supports()` probes, font metric comparison, hover/pointer media queries.
10. Network / Other: WebRTC ICE candidates, known VM private-network ranges, WebSocket RTT to `/ws`, fetch timing to `/ping`.

## Raw Inventory Layer

The UI shows two post-scan data views:

- Normalized hardware snapshot: compact GPU, CPU/timer, memory, display, browser, peripheral, locale, audio/CSS/font, and network values.
- BrowserLeaks-style raw inventory: searchable categories for Navigator, UA Client Hints, Screen/Window, WebGL/WebGPU, Canvas, Audio, Fonts, WebRTC, Media, Network, Storage, Crypto, Permissions, CSS, matchMedia, Battery, Gamepads, Locale, Performance, API availability, Keyboard, Speech, and server-side HTTP view.

These raw values are exported independently via **Export Raw** or together with the score via **Export Bundle**.

## Most Reliable Signals

- WebGL unmasked renderer/vendor strings containing `vmware`, `virtualbox`, `vbox`, `qemu`, or `virgl` are the strongest browser-visible VM indicators because they often leak the virtual GPU adapter.
- `navigator.webdriver=true` and headless browser tokens are strong automation indicators, though automation is not identical to virtualization.
- Known virtual-network ranges from WebRTC, such as `10.0.2.0/24`, `192.168.56.0/24`, and `192.168.122.0/24`, are useful when exposed, but modern browsers often mask host candidates with mDNS.
- Clusters of weak signals are more meaningful than any single weak signal. Privacy or browser-policy-only signals are recorded as informational unless combined with stronger VM evidence.

## Known Limitations

- Browser JavaScript cannot directly read CPUID hypervisor bits, SMBIOS/DMI tables, kernel drivers, PCI IDs, process lists, firmware data, host filesystem artifacts, RAM module details, disk serials, or exact CPU model.
- Privacy hardening can mimic VM behavior by reducing timer precision, hiding plugins/devices, disabling APIs, or masking WebGL details.
- Real hardware can look suspicious in remote desktop sessions, minimal Linux installs, enterprise-managed browsers, private browsing modes, and strict anti-fingerprinting settings.
- VMs with GPU passthrough, realistic display settings, copied browser profiles, and normal peripherals can avoid many browser-visible anomalies.
- HTTP and browser policy differences affect Battery, WebGPU, media devices, SharedArrayBuffer, WebRTC, storage quota, and several hardware-adjacent APIs.

## Sources and Techniques

- WebGL debug renderer info: `WEBGL_debug_renderer_info`
- Browser APIs used: Canvas 2D, WebGL/WebGL2, WebGPU, Performance API, Web Workers, Storage Estimate API, Battery Status API, MediaDevices, Gamepad API, NetworkInformation, WebXR presence, Permissions API, Intl APIs, AudioContext and OfflineAudioContext, CSS.supports, matchMedia, RTCPeerConnection, WebSocket, Fetch, UA Client Hints, Keyboard API, SpeechSynthesis, and server-visible HTTP request headers.
- Timing and rendering probes follow common browser fingerprinting techniques: canvas rendering differences, font metric comparison, timer precision sampling, rAF cadence measurement, local endpoint latency measurement, WebGL parameter dumps, and media/API capability matrices.
