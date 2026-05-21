# Virtual Machine Detector

Browser-based virtual machine and emulation anomaly scanner.

The app runs permissionless browser checks, computes a probabilistic `0..100` VM/anomaly score, shows per-check evidence, exposes a BrowserLeaks-style raw inventory, and exports JSON reports. Reports are never sent to the server automatically.

Live demo:

```text
https://zeldrizz.github.io/virtual-machine-detector/
```

Local full-server build:

```text
http://localhost:9331
```

## Features

- Browser-only VM/anomaly scan with 10 grouped check blocks.
- Calibrated score bands from "Real hardware" to "Likely VM / emulation".
- Detailed raw evidence for each scored check.
- Browser-visible hardware snapshot.
- Searchable raw inventory with WebGL, WebGPU, Canvas, Audio, WebRTC, Storage, Fonts, CSS, Permissions, API availability, locale, timers, media capabilities, and server-visible headers where available.
- JSON exports for the report, hardware snapshot, raw inventory, or combined bundle.
- Explicit opt-in report logging through **Send Report**.
- Docker and Docker Compose support.
- Static GitHub Pages build for public browser-only use.

## Run Locally

Docker Compose:

```bash
docker compose up --build
```

Legacy Docker Compose:

```bash
docker-compose up -d --build
docker-compose logs -f virtual-machine-detector
```

Node.js:

```bash
npm install
npm start
```

The app listens on:

```text
http://localhost:9331
```

If legacy `docker-compose up --build` crashes with a Python traceback such as `KeyError: 'id'` or `KeyError: 'ContainerConfig'`, it is a Docker Compose v1 recreate/log watcher issue. Use detached mode, remove the stale container, or install Docker Compose v2.

## GitHub Pages Build

GitHub Pages serves `app/public` as a static site through `.github/workflows/pages.yml`.

The hosted Pages build runs in static browser-only mode:

- Available: scan score, check details, hardware snapshot, raw inventory, JSON exports.
- Unavailable: Express-only `/report`, `/inspect`, `/ws`, and `/ping`.

Run the Docker or Node.js version when you need report logging, WebSocket RTT checks, server-visible request headers, or `/ping` fetch timing.

## Detection Blocks

The score uses 10 browser-visible blocks:

1. GPU / Rendering: WebGL renderer/vendor, WebGL2 consistency, canvas fingerprint, WebGL limits, WebGPU presence.
2. Hardware / CPU: logical cores, CPU micro-benchmarks, timer precision, SharedArrayBuffer/Atomics, worker throughput.
3. Memory: Chrome heap limits, typed-array allocation speed, DeviceMemory, storage quota estimate.
4. Screen / Display: resolution, DPR, color depth, window/screen ratios, available screen area, window origin.
5. Browser / Navigator: User-Agent, platform/vendor consistency, languages, plugins, MIME types, webdriver, PDF viewer, UA Client Hints.
6. Peripheral APIs: Battery API, touch points, media devices, gamepads, NetworkInformation, WebXR, Permissions API.
7. Timezone / Locale: Intl timezone, language ordering, Date offset consistency, Intl.Collator performance.
8. Timing / Side-channel: performance.now drift, requestAnimationFrame FPS, setTimeout jitter, AudioContext latency, CSS transition timing.
9. CSS / Rendering quirks: CSS.supports probes, font metric spread, hover/pointer media queries.
10. Network / Other: WebRTC ICE candidates, WebSocket RTT to `/ws`, fetch timing to `/ping`.

The raw inventory layer also records extended WebGL/WebGPU parameters, shader precision, API availability, media codec support, storage/crypto details, keyboard layout where available, speech voices, CSS/matchMedia support, and server-visible request data in full-server mode.

## Score Bands

- `0-20`: Real hardware
- `21-45`: Likely real hardware, anomalies found
- `46-70`: Possible virtual machine
- `71-100`: Likely VM / emulation

Signal weights:

- Critical: `+25`
- Strong: `+15`
- Moderate: `+8`
- Weak: `+3`
- Four or more weak signals apply a `1.5x` multiplier to weak-signal points.

The result is probabilistic. Privacy hardening, remote desktop, enterprise policy, unusual Linux/browser builds, and anti-fingerprinting protections can look similar to VM signals. Treat the score as an anomaly indicator, not proof.

## Exports

- **Export JSON**: full detection report with score, findings, hardware snapshot, raw check values, and raw inventory when collected.
- **Export Hardware**: normalized browser-visible hardware snapshot.
- **Export Raw**: BrowserLeaks-style raw inventory.
- **Export Bundle**: report and raw inventory together.

Browser JavaScript cannot expose native-only identifiers such as exact CPU model, RAM module details, disk serials, motherboard firmware tables, PCI IDs, kernel drivers, or CPUID hypervisor bits.

## Server API

These endpoints are available in the Node.js/Docker build:

`GET /ping`

```json
{ "pong": true, "ts": 1710000000000 }
```

`GET /health`

```json
{ "status": "ok", "ts": 1710000000000 }
```

`GET /inspect`

Returns the request as the server sees it: remote address, protocol, host, URL, and HTTP headers.

`POST /report`

Accepts an explicit user-submitted scan report and appends it as JSONL to `scans.log`.

`/ws`

WebSocket echo endpoint used by the RTT probe.

## Privacy

The scanner uses browser fingerprinting-style APIs because browser-only VM detection is fingerprinting by design. It does not install anything, run native code, read local files, or request camera, microphone, or location permission. Data stays in the browser unless **Send Report** is pressed in the full-server build.

## License

MIT
