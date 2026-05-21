# Virtual Machine Detector

Browser-based virtual machine and emulation anomaly scanner. It computes a 0-100 VM score, shows a normalized hardware/browser snapshot, provides a BrowserLeaks-style raw inventory view, exports JSON, and only logs a report when the user presses **Send Report**.

## Quick Start

```bash
git clone <repo-url>
cd vm-detector
docker compose up --build
```

Open:

```text
http://localhost:9331
```

Local Node.js run:

```bash
npm install
npm start
```

On systems that still use legacy Docker Compose v1:

```bash
docker-compose up -d --build
docker-compose logs -f virtual-machine-detector
```

If `docker-compose up --build` crashes with a Python traceback such as `KeyError: 'id'`, that is a Compose v1 log/event watcher bug, not an application crash. Detached mode avoids it, or install the Docker Compose v2 plugin and use `docker compose`.

The Compose image, service, and container are named `virtual-machine-detector` to avoid collisions with other local VM detector experiments.

## Public GitHub Repository

Recommended repository name:

```text
virtual-machine-detector
```

That name matches the app title, npm package, Docker image, and public GitHub Pages URL:

```text
https://<github-username>.github.io/virtual-machine-detector/
```

Create and push the repository with GitHub CLI:

```bash
git init
git branch -M main
git add .
git commit -m "Initial virtual machine detector"
gh repo create virtual-machine-detector --public --source=. --remote=origin --push
```

Or create an empty public repository named `virtual-machine-detector` in the GitHub UI, then run:

```bash
git init
git branch -M main
git add .
git commit -m "Initial virtual machine detector"
git remote add origin git@github.com:<github-username>/virtual-machine-detector.git
git push -u origin main
```

## GitHub Pages

This repository includes `.github/workflows/pages.yml`. On every push to `main`, GitHub Actions publishes `app/public` to GitHub Pages.

In the repository settings, set **Settings -> Pages -> Build and deployment -> Source** to **GitHub Actions**. The static site will deploy after the workflow finishes.

GitHub Pages is static hosting, so the public Pages build runs in browser-only mode:

- Available: VM/anomaly score, checks, hardware snapshot, raw inventory, JSON exports.
- Unavailable on Pages: Express-backed `/report`, `/inspect`, `/ws`, and `/ping`.

For full server-side logging, WebSocket RTT, `/inspect`, and Docker healthcheck behavior, run the Node/Docker version locally or on a server.

## What It Checks

The score uses 10 browser-only blocks:

1. GPU / Rendering: WebGL renderer/vendor, WebGL2 consistency, canvas fingerprint, WebGL limits, WebGPU presence.
2. Hardware / CPU: logical cores, CPU micro-benchmarks, timer precision, SharedArrayBuffer/Atomics, worker throughput.
3. Memory: Chrome heap limits, typed-array allocation speed, DeviceMemory, storage quota estimate.
4. Screen / Display: resolution, DPR, color depth, window/screen ratios, available screen area, window origin.
5. Browser / Navigator: User-Agent, platform/vendor consistency, languages, plugins, MIME types, webdriver, PDF viewer, UA Client Hints.
6. Peripheral APIs: Battery API, touch points, media devices, gamepads, NetworkInformation, WebXR, Permissions API.
7. Timezone / Locale: Intl timezone, language ordering, Date offset consistency, Intl.Collator performance.
8. Timing / Side-channel: performance.now drift, requestAnimationFrame FPS, setTimeout jitter, AudioContext latency, CSS transition timing.
9. CSS / Rendering quirks: CSS.supports probes, font metric spread, hover/pointer media queries.
10. Network / Other: WebRTC ICE candidate IPs, WebSocket RTT to `/ws`, fetch timing to `/ping`.

The raw inventory layer also collects server-visible request headers, extended WebGL/WebGPU data, shader precision, API availability, media codec support, storage/crypto data, keyboard layout where available, speech voices, CSS/matchMedia support, and more.

## Score Interpretation

- `0-20`: Real hardware
- `21-45`: Likely real hardware, anomalies found
- `46-70`: Possible virtual machine
- `71-100`: Likely VM / emulation

Signals are weighted as:

- Critical: `+25`
- Strong: `+15`
- Moderate: `+8`
- Weak: `+3`
- Four or more weak signals apply a `1.5x` multiplier to weak-signal points.

The score is probabilistic. Privacy hardening, remote desktop, enterprise policy, or unusual browser builds can resemble VM signals, so the details panel and raw JSON matter.

## Exports

- **Export JSON** downloads the full detection report with score, findings, hardware snapshot, raw check values, and raw inventory once collected.
- **Export Hardware** downloads a normalized hardware/browser snapshot.
- **Export Raw** downloads the BrowserLeaks-style raw inventory.
- **Export Bundle** downloads the report and raw inventory together.

Browser JavaScript cannot expose native-only identifiers such as exact CPU model, RAM module details, disk serials, motherboard firmware tables, PCI IDs, kernel drivers, or CPUID hypervisor bits.

## API

`GET /ping`

```json
{ "pong": true, "ts": 1710000000000 }
```

`GET /health`

```json
{ "status": "ok", "ts": 1710000000000 }
```

`GET /inspect`

Returns the request as the server sees it: remote address, protocol, host, URL, and HTTP headers. This powers the raw inventory server-side view.

`POST /report`

Accepts the exported scan report and appends it as JSONL to `scans.log` inside the Docker volume. A local `npm start` run writes `scans.log` in the project directory unless `LOG_PATH` is set.

`/ws`

WebSocket echo endpoint used by the browser RTT probe.

## FAQ

### Why did it flag a real machine?

Browsers intentionally reduce or hide hardware details. Firefox fingerprinting protection can coarsen `performance.now()`, mask screen dimensions, hide optional hardware APIs, and restrict local font visibility. Chromium can also expose tight-loop timer collisions and battery states that are normal on real hardware. These are kept as informational context unless paired with stronger VM evidence.

### Are the checks invasive?

The scanner uses browser fingerprinting-style APIs because browser-only VM detection is fundamentally fingerprinting. It does not install anything, run native code, read files, or request camera, microphone, or location permission. Results stay in the browser unless **Send Report** is pressed.

### Why did it not flag a VM?

Modern VMs can expose passthrough GPUs, realistic display settings, normal CPU counts, and copied browser profiles. Browser-only detection cannot inspect firmware tables, hypervisor CPUID bits, kernel drivers, or host devices directly.

### Does it send data automatically?

No. Reports are sent to the backend only when **Send Report** is pressed.

## Screenshot

Add a screenshot here after running the app:

```text
docs/screenshot.png
```
