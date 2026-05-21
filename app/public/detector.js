(function () {
  'use strict';

  const SEVERITY_POINTS = {
    critical: 25,
    strong: 15,
    moderate: 8,
    weak: 3,
    info: 0
  };

  const SEVERITY_RANK = {
    info: 0,
    weak: 1,
    moderate: 2,
    strong: 3,
    critical: 4
  };

  const VM_KEYWORDS = [
    'vmware',
    'virtualbox',
    'vbox',
    'llvmpipe',
    'softpipe',
    'swiftshader',
    'mesa',
    'qemu',
    'virgl',
    'microsoft basic render'
  ];

  const CHECKS = [
    { id: 'gpu', block: 'Block 1', name: 'GPU / Rendering', run: runGpuCheck },
    { id: 'cpu', block: 'Block 2', name: 'Hardware / CPU', run: runCpuCheck },
    { id: 'memory', block: 'Block 3', name: 'Memory', run: runMemoryCheck },
    { id: 'screen', block: 'Block 4', name: 'Screen / Display', run: runScreenCheck },
    { id: 'browser', block: 'Block 5', name: 'Browser / Navigator', run: runBrowserCheck },
    { id: 'peripherals', block: 'Block 6', name: 'Peripheral APIs', run: runPeripheralCheck },
    { id: 'locale', block: 'Block 7', name: 'Timezone / Locale', run: runLocaleCheck },
    { id: 'timing', block: 'Block 8', name: 'Timing / Side-channel', run: runTimingCheck },
    { id: 'css', block: 'Block 9', name: 'CSS / Rendering Quirks', run: runCssCheck },
    { id: 'network', block: 'Block 10', name: 'Network / Other', run: runNetworkCheck }
  ];

  const els = {};
  const cards = new Map();
  const webglInfoCache = new Map();
  let currentReport = null;
  let currentRawInventory = null;
  let lastScore = 0;

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    setupTheme();
    bindActions();
    renderSkeleton();
    runScan();
  });

  function cacheElements() {
    Object.assign(els, {
      html: document.documentElement,
      runMeta: document.getElementById('runMeta'),
      themeToggle: document.getElementById('themeToggle'),
      restartButton: document.getElementById('restartButton'),
      exportButton: document.getElementById('exportButton'),
      hardwareExportButton: document.getElementById('hardwareExportButton'),
      rawExportButton: document.getElementById('rawExportButton'),
      bundleExportButton: document.getElementById('bundleExportButton'),
      reportButton: document.getElementById('reportButton'),
      reportStatus: document.getElementById('reportStatus'),
      scoreGauge: document.getElementById('scoreGauge'),
      scoreValue: document.getElementById('scoreValue'),
      verdictText: document.getElementById('verdictText'),
      checksDone: document.getElementById('checksDone'),
      signalCount: document.getElementById('signalCount'),
      runtimeValue: document.getElementById('runtimeValue'),
      globalProgress: document.getElementById('globalProgress'),
      checksList: document.getElementById('checksList'),
      hardwarePanel: document.getElementById('hardwarePanel'),
      hardwareGrid: document.getElementById('hardwareGrid'),
      hardwareRaw: document.getElementById('hardwareRaw'),
      hardwareMeta: document.getElementById('hardwareMeta'),
      rawPanel: document.getElementById('rawPanel'),
      rawContent: document.getElementById('rawContent'),
      rawFilter: document.getElementById('rawFilter'),
      rawMeta: document.getElementById('rawMeta'),
      rawToggleButton: document.getElementById('rawToggleButton')
    });
  }

  function setupTheme() {
    const stored = localStorage.getItem('virtual-machine-detector-theme');
    const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(stored || preferred);
  }

  function setTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    els.html.dataset.theme = normalized;
    els.themeToggle.textContent = normalized === 'light' ? 'D' : 'L';
    localStorage.setItem('virtual-machine-detector-theme', normalized);
  }

  function bindActions() {
    els.themeToggle.addEventListener('click', () => {
      setTheme(els.html.dataset.theme === 'light' ? 'dark' : 'light');
    });
    els.restartButton.addEventListener('click', runScan);
    els.exportButton.addEventListener('click', exportJson);
    els.hardwareExportButton.addEventListener('click', exportHardwareJson);
    els.rawExportButton.addEventListener('click', exportRawJson);
    els.bundleExportButton.addEventListener('click', exportBundleJson);
    els.reportButton.addEventListener('click', submitReport);
    els.rawFilter.addEventListener('input', applyRawFilter);
    els.rawToggleButton.addEventListener('click', toggleRawCards);
  }

  function renderSkeleton() {
    els.checksList.textContent = '';
    cards.clear();

    for (const check of CHECKS) {
      const details = document.createElement('details');
      details.className = 'check-card';
      details.dataset.status = 'pending';
      details.dataset.id = check.id;

      const summary = document.createElement('summary');
      summary.className = 'check-summary';

      const state = document.createElement('span');
      state.className = 'state';
      state.setAttribute('aria-hidden', 'true');

      const title = document.createElement('div');
      title.className = 'check-title';
      const name = document.createElement('strong');
      name.textContent = check.name;
      const sub = document.createElement('span');
      sub.textContent = `${check.block} - Pending`;
      title.append(name, sub);

      const points = document.createElement('span');
      points.className = 'points-pill';
      points.textContent = '0 pts';

      summary.append(state, title, points);

      const body = document.createElement('div');
      body.className = 'check-body';
      const findings = document.createElement('ul');
      findings.className = 'finding-list';
      const li = document.createElement('li');
      li.dataset.severity = 'info';
      li.textContent = 'Pending';
      findings.append(li);
      const raw = document.createElement('pre');
      raw.textContent = '{}';
      body.append(findings, raw);

      details.append(summary, body);
      els.checksList.append(details);
      cards.set(check.id, { details, sub, points, findings, raw });
    }
  }

  async function runScan() {
    currentReport = null;
    currentRawInventory = null;
    lastScore = 0;
    els.exportButton.disabled = true;
    els.hardwareExportButton.disabled = true;
    els.rawExportButton.disabled = true;
    els.bundleExportButton.disabled = true;
    els.reportButton.disabled = true;
    els.reportStatus.textContent = '';
    els.verdictText.textContent = 'Scanning';
    els.hardwarePanel.hidden = true;
    els.hardwareGrid.textContent = '';
    els.hardwareRaw.textContent = '{}';
    els.rawPanel.hidden = false;
    els.rawContent.innerHTML = '<div class="raw-placeholder">Raw inventory will start after the VM score completes.</div>';
    els.rawMeta.textContent = 'Waiting for scan';
    els.rawFilter.value = '';
    setGauge(0);
    renderSkeleton();

    const startedAt = new Date().toISOString();
    const startedPerf = performance.now();
    const completed = new Map();
    const context = { startedAt, startedPerf };

    updateProgress(completed, startedPerf);

    async function runOne(id) {
      const definition = CHECKS.find((check) => check.id === id);
      updateCard(definition.id, {
        id: definition.id,
        block: definition.block,
        name: definition.name,
        status: 'running',
        points: 0,
        summary: 'Running',
        raw: {},
        findings: []
      });

      try {
        const started = performance.now();
        const result = await definition.run(context);
        const normalized = normalizeResult(definition, result, performance.now() - started);
        completed.set(definition.id, normalized);
        updateCard(definition.id, normalized);
      } catch (error) {
        const failed = normalizeResult(definition, {
          summary: 'Check failed',
          raw: { error: error && error.message ? error.message : String(error) },
          findings: [finding('weak', 'Check failed', 'The browser rejected this probe or returned an unexpected error.')]
        }, 0);
        completed.set(definition.id, failed);
        updateCard(definition.id, failed);
      }

      updateProgress(completed, startedPerf);
    }

    await Promise.all(['gpu', 'screen', 'browser', 'peripherals', 'locale', 'css', 'network'].map(runOne));
    await runOne('cpu');
    await runOne('memory');
    await runOne('timing');

    const checks = CHECKS.map((check) => completed.get(check.id));
    const scoring = calculateScore(checks);
    const verdict = getVerdict(scoring.score);
    const finishedAt = new Date().toISOString();
    const runtimeMs = Math.round(performance.now() - startedPerf);

    currentReport = {
      score: scoring.score,
      verdict: verdict.label,
      startedAt,
      finishedAt,
      runtimeMs,
      checks,
      environment: collectEnvironment(),
      scoring
    };
    currentReport.hardwareSnapshot = buildHardwareSnapshot(currentReport);

    els.verdictText.textContent = verdict.label;
    els.runMeta.textContent = `Finished ${finishedAt}`;
    els.runtimeValue.textContent = `${runtimeMs} ms`;
    els.exportButton.disabled = false;
    els.hardwareExportButton.disabled = false;
    els.reportButton.disabled = isStaticPagesMode();
    if (isStaticPagesMode()) {
      els.reportStatus.textContent = 'Static mode: export JSON instead';
    }
    els.globalProgress.textContent = 'Complete';
    renderHardwareSnapshot(currentReport.hardwareSnapshot);
    setGauge(scoring.score);
    collectAndRenderRawInventory(currentReport);
  }

  function normalizeResult(definition, result, elapsedMs) {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const points = findings.reduce((sum, item) => sum + (SEVERITY_POINTS[item.severity] || 0), 0);
    const severity = findings.reduce((max, item) => {
      return SEVERITY_RANK[item.severity] > SEVERITY_RANK[max] ? item.severity : max;
    }, 'info');

    let status = 'ok';
    if (severity === 'critical' || severity === 'strong') {
      status = 'critical';
    } else if (points > 0) {
      status = 'warn';
    }

    let summary = result.summary || (findings.length ? `${findings.length} suspicious signal(s)` : 'No suspicious signals');
    if (points === 0 && findings.length > 0) {
      summary = 'No scored VM signals; informational notes only';
    } else if (points === 0) {
      summary = 'No suspicious signals';
    }

    return {
      id: definition.id,
      block: definition.block,
      name: definition.name,
      status,
      points,
      severity,
      summary,
      raw: Object.assign({ elapsedMs: Math.round(elapsedMs) }, result.raw || {}),
      findings
    };
  }

  function updateCard(id, result) {
    const card = cards.get(id);
    if (!card) {
      return;
    }

    card.details.dataset.status = result.status;
    card.sub.textContent = `${result.block} - ${result.summary}`;
    card.points.textContent = `${result.points || 0} pts`;
    card.findings.textContent = '';

    const findings = result.findings && result.findings.length
      ? result.findings
      : [finding('info', 'Clean', result.status === 'running' ? 'Running' : 'No suspicious signals detected.')];

    for (const item of findings) {
      const li = document.createElement('li');
      li.dataset.severity = item.severity || 'info';
      const strong = document.createElement('strong');
      strong.textContent = item.title || item.severity || 'Signal';
      li.append(strong, document.createTextNode(item.detail ? ` - ${item.detail}` : ''));
      card.findings.append(li);
    }

    card.raw.textContent = JSON.stringify(result.raw || {}, null, 2);
    if (result.points > 0) {
      card.details.open = true;
    }
  }

  function updateProgress(completed, startedPerf) {
    const done = completed.size;
    const checks = Array.from(completed.values());
    const signalCount = checks.reduce((sum, check) => sum + check.findings.filter((item) => item.severity !== 'info').length, 0);
    els.checksDone.textContent = `${done}/${CHECKS.length}`;
    els.signalCount.textContent = String(signalCount);
    els.runtimeValue.textContent = `${Math.round(performance.now() - startedPerf)} ms`;
    els.globalProgress.textContent = done === CHECKS.length ? 'Complete' : `${done}/${CHECKS.length}`;
    els.runMeta.textContent = done === 0 ? 'Starting scan' : `Running ${done}/${CHECKS.length}`;
  }

  function calculateScore(checks) {
    const allFindings = checks.flatMap((check) => check.findings || []);
    const baseScore = allFindings.reduce((sum, item) => sum + (SEVERITY_POINTS[item.severity] || 0), 0);
    const weakCount = allFindings.filter((item) => item.severity === 'weak').length;
    const weakPoints = weakCount * SEVERITY_POINTS.weak;
    const weakMultiplier = weakCount >= 4 ? 1.5 : 1;
    const score = clamp(Math.round(baseScore + ((weakMultiplier - 1) * weakPoints)), 0, 100);

    return {
      score,
      baseScore,
      weakCount,
      weakMultiplier,
      capped: score === 100 && baseScore > 100
    };
  }

  function getVerdict(score) {
    if (score <= 20) {
      return { label: 'Real hardware', band: 'green' };
    }
    if (score <= 45) {
      return { label: 'Likely real hardware, anomalies found', band: 'yellow' };
    }
    if (score <= 70) {
      return { label: 'Possible virtual machine', band: 'orange' };
    }
    return { label: 'Likely VM / emulation', band: 'red' };
  }

  function setGauge(score) {
    const start = lastScore;
    const end = clamp(score, 0, 100);
    const started = performance.now();
    const duration = 480;

    function step(now) {
      const t = clamp((now - started) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(start + ((end - start) * eased));
      els.scoreGauge.style.setProperty('--score', String(value));
      els.scoreValue.textContent = String(value);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        lastScore = end;
      }
    }

    requestAnimationFrame(step);
  }

  function exportJson() {
    if (!currentReport) {
      return;
    }
    exportDataJson(currentReport, `vm-detection-report-${Date.now()}.json`);
  }

  function exportHardwareJson() {
    if (!currentReport || !currentReport.hardwareSnapshot) {
      return;
    }
    exportDataJson(currentReport.hardwareSnapshot, `vm-hardware-snapshot-${Date.now()}.json`);
  }

  function exportRawJson() {
    if (!currentRawInventory) {
      return;
    }
    exportDataJson(currentRawInventory, `virtual-machine-detector-raw-${Date.now()}.json`);
  }

  function exportBundleJson() {
    if (!currentReport && !currentRawInventory) {
      return;
    }
    exportDataJson({
      generatedAt: new Date().toISOString(),
      url: location.href,
      report: currentReport,
      rawInventory: currentRawInventory
    }, `virtual-machine-detector-bundle-${Date.now()}.json`);
  }

  function exportDataJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function submitReport() {
    if (!currentReport) {
      return;
    }
    if (isStaticPagesMode()) {
      els.reportStatus.textContent = 'Server logging unavailable on GitHub Pages';
      return;
    }
    els.reportButton.disabled = true;
    els.reportStatus.textContent = 'Sending';
    try {
      const response = await fetch(apiPath('/report'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentReport)
      });
      const body = await response.json().catch(() => ({}));
      els.reportStatus.textContent = response.ok && body.ok ? 'Report logged' : 'Report rejected';
    } catch (error) {
      els.reportStatus.textContent = 'Report failed';
    } finally {
      els.reportButton.disabled = false;
    }
  }

  function collectEnvironment() {
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      platform: navigator.platform,
      vendor: navigator.vendor,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      secureContext: window.isSecureContext,
      timestamp: new Date().toISOString()
    };
  }

  function buildHardwareSnapshot(report) {
    const raw = (id) => {
      const check = report.checks.find((item) => item.id === id);
      return check ? check.raw || {} : {};
    };
    const gpu = raw('gpu');
    const cpu = raw('cpu');
    const memory = raw('memory');
    const screenRaw = raw('screen');
    const browser = raw('browser');
    const peripherals = raw('peripherals');
    const locale = raw('locale');
    const timing = raw('timing');
    const css = raw('css');
    const network = raw('network');

    return {
      generatedAt: new Date().toISOString(),
      score: report.score,
      verdict: report.verdict,
      visibleFields: countVisibleFields({
        gpu,
        cpu,
        memory,
        screen: screenRaw,
        browser,
        peripherals,
        locale,
        timing,
        css,
        network
      }),
      categories: {
        systemBrowser: {
          userAgent: browser.userAgent,
          platform: browser.platform,
          vendor: browser.vendor,
          language: browser.language,
          languages: browser.languages,
          cookieEnabled: browser.cookieEnabled,
          doNotTrack: browser.doNotTrack,
          webdriver: browser.webdriver,
          pdfViewerEnabled: browser.pdfViewerEnabled,
          pluginsLength: browser.pluginsLength,
          mimeTypesLength: browser.mimeTypesLength,
          userAgentData: browser.userAgentData,
          secureContext: report.environment.secureContext
        },
        cpuAndTimers: {
          logicalProcessors: cpu.hardwareConcurrency,
          emptyLoopMs: valueAt(cpu, 'emptyLoop.ms'),
          sqrtLoopMs: valueAt(cpu, 'sqrtLoop.ms'),
          performanceNowPrecision: cpu.precision,
          performanceNowDrift: timing.drift,
          sharedArrayBufferAndAtomics: cpu.sharedArrayBuffer,
          workerThroughput: cpu.workerEstimate
        },
        gpuAndRendering: {
          webglVendor: valueAt(gpu, 'webgl.vendor'),
          webglRenderer: valueAt(gpu, 'webgl.renderer'),
          webglUnmaskedVendor: valueAt(gpu, 'webgl.unmaskedVendor'),
          webglUnmaskedRenderer: valueAt(gpu, 'webgl.unmaskedRenderer'),
          webglVersion: valueAt(gpu, 'webgl.version'),
          webgl2Supported: valueAt(gpu, 'webgl2.supported'),
          webgl2UnmaskedRenderer: valueAt(gpu, 'webgl2.unmaskedRenderer'),
          webglLimits: valueAt(gpu, 'webgl.params'),
          webgpu: gpu.webgpu,
          canvasFingerprint: gpu.canvas
        },
        memoryAndStorage: {
          performanceMemory: memory.performanceMemory,
          deviceMemoryGb: memory.deviceMemory,
          allocationProbe: memory.allocation,
          storageEstimate: memory.storage
        },
        displayAndWindow: {
          screenWidth: screenRaw.width,
          screenHeight: screenRaw.height,
          availableWidth: screenRaw.availWidth,
          availableHeight: screenRaw.availHeight,
          colorDepth: screenRaw.colorDepth,
          pixelDepth: screenRaw.pixelDepth,
          innerWidth: screenRaw.innerWidth,
          innerHeight: screenRaw.innerHeight,
          outerWidth: screenRaw.outerWidth,
          outerHeight: screenRaw.outerHeight,
          devicePixelRatio: screenRaw.devicePixelRatio,
          screenLeft: screenRaw.screenLeft,
          screenTop: screenRaw.screenTop
        },
        peripheralsAndApis: {
          battery: peripherals.battery,
          maxTouchPoints: peripherals.maxTouchPoints,
          mediaDevices: peripherals.mediaDevices,
          gamepads: peripherals.gamepads,
          connection: peripherals.connection,
          xr: peripherals.xr,
          permissions: peripherals.permissions,
          apiPresence: peripherals.apiPresence
        },
        localeAndTime: {
          timezone: locale.timezone,
          locale: locale.locale,
          calendar: locale.calendar,
          numberingSystem: locale.numberingSystem,
          navigatorLanguage: locale.navigatorLanguage,
          navigatorLanguages: locale.navigatorLanguages,
          intlOffsetMinutes: locale.intlOffsetMinutes,
          dateOffsetMinutes: locale.dateOffsetMinutes,
          collatorBenchmark: locale.collator
        },
        audioCssFonts: {
          audio: timing.audio,
          cssAnimation: timing.cssAnimation,
          cssSupports: css.supports,
          fontRendering: css.fonts,
          mediaQueries: css.media
        },
        networkAndLocality: {
          webrtc: network.webrtc,
          websocket: network.websocket,
          fetchTiming: network.fetchTiming
        }
      },
      scoredSignals: report.checks.flatMap((check) => {
        return (check.findings || [])
          .filter((item) => item.severity !== 'info')
          .map((item) => ({
            check: check.name,
            severity: item.severity,
            title: item.title,
            detail: item.detail
          }));
      }),
      rawByCheck: Object.fromEntries(report.checks.map((check) => [check.id, check.raw || {}]))
    };
  }

  function renderHardwareSnapshot(snapshot) {
    els.hardwarePanel.hidden = false;
    els.hardwareGrid.textContent = '';
    els.hardwareMeta.textContent = `${snapshot.visibleFields} browser-visible fields`;
    els.hardwareRaw.textContent = JSON.stringify(snapshot, null, 2);

    const sections = [
      ['System / Browser', snapshot.categories.systemBrowser],
      ['CPU / Timers', snapshot.categories.cpuAndTimers],
      ['GPU / Rendering', snapshot.categories.gpuAndRendering],
      ['Memory / Storage', snapshot.categories.memoryAndStorage],
      ['Display / Window', snapshot.categories.displayAndWindow],
      ['Peripherals / APIs', snapshot.categories.peripheralsAndApis],
      ['Locale / Time', snapshot.categories.localeAndTime],
      ['Audio / CSS / Fonts', snapshot.categories.audioCssFonts],
      ['Network / Locality', snapshot.categories.networkAndLocality]
    ];

    for (const [title, data] of sections) {
      const article = document.createElement('article');
      article.className = 'hardware-section';

      const heading = document.createElement('h3');
      heading.textContent = title;

      const list = document.createElement('dl');
      for (const [key, value] of Object.entries(data)) {
        const dt = document.createElement('dt');
        dt.textContent = humanizeKey(key);
        const dd = document.createElement('dd');
        dd.textContent = stringifySnapshotValue(value);
        list.append(dt, dd);
      }

      article.append(heading, list);
      els.hardwareGrid.append(article);
    }
  }

  async function collectAndRenderRawInventory(report) {
    els.rawPanel.hidden = false;
    els.rawExportButton.disabled = true;
    els.bundleExportButton.disabled = true;
    els.rawMeta.textContent = 'Collecting extended browser-visible data';
    els.rawContent.innerHTML = '<div class="raw-placeholder">Collecting extended raw inventory...</div>';

    try {
      currentRawInventory = await collectRawInventory(report);
      if (currentReport) {
        currentReport.rawInventory = currentRawInventory;
      }
      renderRawInventory(currentRawInventory);
      els.rawMeta.textContent = `${countVisibleFields(currentRawInventory)} raw fields across ${Object.keys(currentRawInventory.categories).length} categories`;
      els.rawExportButton.disabled = false;
      els.bundleExportButton.disabled = false;
    } catch (error) {
      currentRawInventory = {
        generatedAt: new Date().toISOString(),
        error: error && error.message ? error.message : String(error)
      };
      els.rawContent.innerHTML = '<div class="raw-placeholder">Raw inventory collection failed. The VM score is still valid.</div>';
      els.rawMeta.textContent = 'Raw inventory failed';
      els.bundleExportButton.disabled = false;
    }
  }

  function renderRawInventory(raw) {
    els.rawContent.textContent = '';

    for (const [category, data] of Object.entries(raw.categories || {})) {
      const card = document.createElement('article');
      card.className = 'raw-card';

      const rows = flattenRawRows(data);
      const head = document.createElement('div');
      head.className = 'raw-card-head';
      head.tabIndex = 0;
      head.setAttribute('role', 'button');
      head.setAttribute('aria-expanded', 'true');

      const title = document.createElement('div');
      title.className = 'raw-card-title';
      title.textContent = category;

      const count = document.createElement('span');
      count.className = 'raw-card-count';
      count.textContent = String(rows.length);
      head.append(title, count);

      const body = document.createElement('div');
      body.className = 'raw-body';
      for (const [key, value] of rows) {
        const row = document.createElement('div');
        row.className = 'raw-row';
        row.dataset.key = key;
        row.dataset.value = stringifyRawValue(value);

        const keyEl = document.createElement('div');
        keyEl.className = 'raw-key';
        keyEl.textContent = key;

        const valueEl = document.createElement('div');
        valueEl.className = `raw-value ${rawValueClass(value)}`;
        valueEl.textContent = stringifyRawValue(value);

        row.append(keyEl, valueEl);
        body.append(row);
      }

      const toggle = () => {
        const isCollapsed = card.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!isCollapsed));
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });

      card.append(head, body);
      els.rawContent.append(card);
    }

    applyRawFilter();
  }

  function applyRawFilter() {
    const query = (els.rawFilter.value || '').trim().toLowerCase();
    const cards = Array.from(els.rawContent.querySelectorAll('.raw-card'));
    for (const card of cards) {
      let visibleRows = 0;
      for (const row of card.querySelectorAll('.raw-row')) {
        const haystack = `${row.dataset.key || ''} ${row.dataset.value || ''}`.toLowerCase();
        const visible = !query || haystack.includes(query);
        row.classList.toggle('hidden', !visible);
        if (visible) {
          visibleRows += 1;
        }
      }
      card.hidden = query && visibleRows === 0;
    }
  }

  function toggleRawCards() {
    const cards = Array.from(els.rawContent.querySelectorAll('.raw-card'));
    const shouldCollapse = cards.some((card) => !card.classList.contains('collapsed'));
    for (const card of cards) {
      card.classList.toggle('collapsed', shouldCollapse);
      const head = card.querySelector('.raw-card-head');
      if (head) {
        head.setAttribute('aria-expanded', String(!shouldCollapse));
      }
    }
    els.rawToggleButton.textContent = shouldCollapse ? 'Expand' : 'Collapse';
  }

  async function runGpuCheck() {
    const findings = [];
    const webgl = getWebGLInfo('webgl');
    const webgl2 = getWebGLInfo('webgl2');
    const canvas = getCanvasFingerprint();
    const raw = { webgl, webgl2, canvas, webgpu: { supported: Boolean(navigator.gpu), secureContext: window.isSecureContext } };

    const rendererText = [
      webgl.vendor,
      webgl.renderer,
      webgl.unmaskedVendor,
      webgl.unmaskedRenderer,
      webgl2.vendor,
      webgl2.renderer,
      webgl2.unmaskedVendor,
      webgl2.unmaskedRenderer
    ].filter(Boolean).join(' ');

    const keywordHit = classifyVmKeyword(rendererText);
    if (keywordHit) {
      findings.push(finding(
        keywordHit.severity,
        `GPU renderer contains "${keywordHit.keyword}"`,
        `Renderer/vendor string: ${rendererText || 'empty'}`
      ));
    }

    if (!webgl.supported) {
      findings.push(finding('strong', 'WebGL unavailable', 'Modern desktop browsers normally expose WebGL unless blocked or software-restricted.'));
    }

    if (webgl.supported && !webgl2.supported && isModernBrowser()) {
      findings.push(finding('moderate', 'WebGL2 missing', 'WebGL1 is available but WebGL2 is not available in a modern browser.'));
    }

    if (webgl.supported && webgl2.supported) {
      const r1 = normalizeText(webgl.unmaskedRenderer || webgl.renderer);
      const r2 = normalizeText(webgl2.unmaskedRenderer || webgl2.renderer);
      if (r1 && r2 && r1 !== r2) {
        findings.push(finding('weak', 'WebGL renderer mismatch', 'WebGL1 and WebGL2 expose different renderer strings.'));
      }
    }

    if (webgl.params) {
      const maxTexture = Number(webgl.params.maxTextureSize || 0);
      const maxRenderbuffer = Number(webgl.params.maxRenderbufferSize || 0);
      const viewport = webgl.params.maxViewportDims || [];
      const minViewport = viewport.length ? Math.min(...viewport.map(Number)) : 0;
      if (maxTexture > 0 && maxTexture < 8192) {
        findings.push(finding('moderate', 'Low MAX_TEXTURE_SIZE', `Reported value is ${maxTexture}.`));
      }
      if (maxRenderbuffer > 0 && maxRenderbuffer < 8192) {
        findings.push(finding('weak', 'Low MAX_RENDERBUFFER_SIZE', `Reported value is ${maxRenderbuffer}.`));
      }
      if (minViewport > 0 && minViewport < 8192) {
        findings.push(finding('weak', 'Low MAX_VIEWPORT_DIMS', `Reported value is ${viewport.join(' x ')}.`));
      }
    }

    if (canvas.dataUrlLength < 12000) {
      findings.push(finding('moderate', 'Small canvas fingerprint', `Canvas data URL length is ${canvas.dataUrlLength}.`));
    } else if (canvas.dataUrlLength % 1000 === 0 || canvas.dataUrlLength % 512 === 0) {
      findings.push(finding('weak', 'Round canvas fingerprint length', `Canvas data URL length is ${canvas.dataUrlLength}.`));
    }

    if (!navigator.gpu && isModernChromium() && isPotentiallySecureOrigin()) {
      findings.push(finding('weak', 'WebGPU missing', 'A modern Chromium browser on a secure or localhost origin usually exposes navigator.gpu.'));
    }

    return {
      summary: findings.length ? `${findings.length} rendering anomaly signal(s)` : 'Renderer profile is coherent',
      raw,
      findings
    };
  }

  async function runCpuCheck() {
    const findings = [];
    const hardwareConcurrency = navigator.hardwareConcurrency || 0;
    const emptyLoop = benchmarkEmptyLoop();
    const sqrtLoop = benchmarkSqrtLoop();
    const precision = measurePerformancePrecision();
    const sharedArrayBuffer = benchmarkSharedArrayBuffer();
    const workerEstimate = await estimateWorkerThroughput(hardwareConcurrency);
    const raw = { hardwareConcurrency, emptyLoop, sqrtLoop, precision, sharedArrayBuffer, workerEstimate };

    if (!hardwareConcurrency) {
      findings.push(finding('weak', 'CPU core count unavailable', 'navigator.hardwareConcurrency returned no usable value.'));
    } else if (hardwareConcurrency <= 1) {
      findings.push(finding('strong', 'Single logical core', `navigator.hardwareConcurrency is ${hardwareConcurrency}.`));
    } else if (hardwareConcurrency <= 2) {
      findings.push(finding('moderate', 'Low logical core count', `navigator.hardwareConcurrency is ${hardwareConcurrency}.`));
    }

    if (emptyLoop.ms > 20 || sqrtLoop.ms > 35) {
      findings.push(finding('moderate', 'Slow CPU benchmark', `Empty loop ${emptyLoop.ms.toFixed(2)} ms, sqrt loop ${sqrtLoop.ms.toFixed(2)} ms.`));
    } else if (emptyLoop.ms > 10 || sqrtLoop.ms > 18) {
      findings.push(finding('weak', 'Elevated CPU benchmark time', `Empty loop ${emptyLoop.ms.toFixed(2)} ms, sqrt loop ${sqrtLoop.ms.toFixed(2)} ms.`));
    }

    if (precision.minPositiveDelta >= 1) {
      findings.push(finding(
        isPrivacyHardenedTimer(precision) ? 'info' : 'weak',
        isFirefoxUA() ? 'Firefox timer precision protection' : 'Coarse performance.now precision',
        `Minimum positive delta is ${precision.minPositiveDelta.toFixed(3)} ms. This is privacy or browser policy evidence, not VM proof by itself.`
      ));
    } else if (precision.minPositiveDelta >= 0.5) {
      findings.push(finding('info', 'Reduced timer precision', `Minimum positive delta is ${precision.minPositiveDelta.toFixed(3)} ms.`));
    } else if (precision.sameValueRatio > 0.92) {
      findings.push(finding('info', 'High tight-loop timer collision rate', `Same-value ratio is ${(precision.sameValueRatio * 100).toFixed(1)}%, but timer resolution is still ${precision.minPositiveDelta.toFixed(3)} ms.`));
    }

    if (workerEstimate.supported && hardwareConcurrency >= 4 && workerEstimate.completedWorkers < Math.min(4, hardwareConcurrency)) {
      findings.push(finding('weak', 'Low worker completion count', `${workerEstimate.completedWorkers} workers completed within the probe window.`));
    }

    return {
      summary: findings.length ? `${findings.length} CPU/timing signal(s)` : 'CPU profile is within expected browser ranges',
      raw,
      findings
    };
  }

  async function runMemoryCheck() {
    const findings = [];
    const performanceMemory = getPerformanceMemory();
    const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
    const allocation = benchmarkAllocation();
    const storage = await estimateStorage();
    const raw = { performanceMemory, deviceMemory, allocation, storage };

    if (performanceMemory && performanceMemory.jsHeapSizeLimit < 512 * 1024 * 1024) {
      findings.push(finding('moderate', 'Low JS heap limit', `jsHeapSizeLimit is ${formatBytes(performanceMemory.jsHeapSizeLimit)}.`));
    }

    if (deviceMemory !== null && deviceMemory <= 1) {
      findings.push(finding('moderate', 'Low DeviceMemory value', `navigator.deviceMemory is ${deviceMemory} GB.`));
    }

    if (allocation.error) {
      findings.push(finding('strong', 'Allocation probe failed', allocation.error));
    } else if (allocation.ms > 250) {
      findings.push(finding('moderate', 'Slow typed-array allocation', `16 MB write probe took ${allocation.ms.toFixed(2)} ms.`));
    } else if (allocation.ms > 120) {
      findings.push(finding('weak', 'Elevated allocation latency', `16 MB write probe took ${allocation.ms.toFixed(2)} ms.`));
    }

    if (storage.quota && storage.quota < 1024 * 1024 * 1024) {
      findings.push(finding('weak', 'Low storage quota estimate', `Estimated quota is ${formatBytes(storage.quota)}.`));
    }

    return {
      summary: findings.length ? `${findings.length} memory/storage signal(s)` : 'Memory limits look normal',
      raw,
      findings
    };
  }

  async function runScreenCheck() {
    const findings = [];
    const raw = {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      screenLeft: window.screenLeft,
      screenTop: window.screenTop,
      hardwareConcurrency: navigator.hardwareConcurrency || null
    };

    const resolution = `${screen.width}x${screen.height}`;
    const suspiciousResolution = ['800x600', '1024x768', '1280x800'].includes(resolution);
    const lowCores = (navigator.hardwareConcurrency || 0) <= 2;
    if (suspiciousResolution && lowCores) {
      findings.push(finding('moderate', 'Classic VM display profile', `${resolution} with ${navigator.hardwareConcurrency || 'unknown'} logical cores.`));
    } else if (suspiciousResolution) {
      findings.push(finding('weak', 'Common VM resolution', `${resolution} is common in default VM display setups.`));
    }

    if (window.devicePixelRatio === 1 && isDesktopUA()) {
      findings.push(finding(
        suspiciousResolution || lowCores ? 'weak' : 'info',
        'DevicePixelRatio is 1',
        suspiciousResolution || lowCores
          ? 'DPR=1 is weakly suspicious when clustered with low cores or default VM resolutions.'
          : 'DPR=1 is common on many real desktop monitors and is not scored alone.'
      ));
    }

    if (screen.colorDepth < 24) {
      findings.push(finding('moderate', 'Low color depth', `screen.colorDepth is ${screen.colorDepth}.`));
    }

    const cssScreen = getCssScreenSize();
    const nearlyMaximized = isNearlyMaximized(raw, cssScreen);
    if (window.outerWidth && window.innerWidth && Math.abs(window.outerWidth - window.innerWidth) <= 1 && isDesktopUA()) {
      findings.push(finding(
        suspiciousResolution || lowCores ? 'weak' : 'info',
        'Outer and inner widths match',
        suspiciousResolution || lowCores
          ? 'Matching widths are weakly suspicious only when combined with VM-like display defaults.'
          : 'This is common for maximized Linux/Wayland/Chromium windows and is not VM evidence by itself.'
      ));
    }

    if (screen.availWidth === screen.width && screen.availHeight === screen.height && isDesktopUA()) {
      findings.push(finding(
        suspiciousResolution || lowCores ? 'weak' : 'info',
        isFirefoxUA() ? 'Firefox may mask available screen size' : 'Available screen equals full screen',
        isFirefoxUA()
          ? 'Firefox fingerprinting protection can intentionally report availWidth/availHeight equal to full screen size.'
          : (suspiciousResolution || lowCores
            ? 'This is weakly suspicious only when combined with VM-like display defaults.'
            : 'Some Linux desktops and browser privacy modes report no reserved work area; this is not scored alone.')
      ));
    }

    if (window.screenLeft === 0 && window.screenTop === 0 && isDesktopUA() && !nearlyMaximized) {
      findings.push(finding(
        suspiciousResolution || lowCores ? 'weak' : 'info',
        'Window origin at zero',
        suspiciousResolution || lowCores
          ? 'A top-left origin is weakly suspicious when paired with other VM-like display defaults.'
          : 'A window origin at zero is common and is not VM evidence by itself.'
      ));
    } else if (window.screenLeft === 0 && window.screenTop === 0 && isDesktopUA()) {
      findings.push(finding('info', 'Window origin at zero', 'The window appears maximized or aligned to the display origin.'));
    }

    return {
      summary: findings.length ? `${findings.length} display signal(s)` : 'Display metrics are coherent',
      raw,
      findings
    };
  }

  async function runBrowserCheck() {
    const findings = [];
    const webgl = getWebGLInfo('webgl');
    const uaData = await getUserAgentData();
    const raw = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      pluginsLength: navigator.plugins ? navigator.plugins.length : null,
      mimeTypesLength: navigator.mimeTypes ? navigator.mimeTypes.length : null,
      webdriver: navigator.webdriver,
      pdfViewerEnabled: navigator.pdfViewerEnabled,
      userAgentData: uaData,
      webgl: {
        vendor: webgl.unmaskedVendor || webgl.vendor,
        renderer: webgl.unmaskedRenderer || webgl.renderer
      }
    };

    const uaHit = classifyVmKeyword(navigator.userAgent);
    if (uaHit) {
      findings.push(finding(uaHit.severity, `User-Agent contains "${uaHit.keyword}"`, navigator.userAgent));
    }

    if (/HeadlessChrome|PhantomJS|SlimerJS/i.test(navigator.userAgent)) {
      findings.push(finding('strong', 'Automation browser token', 'User-Agent contains a known headless or automation token.'));
    }

    if (navigator.webdriver === true) {
      findings.push(finding('strong', 'navigator.webdriver is true', 'The browser reports WebDriver automation.'));
    }

    if (!navigator.vendor && !isFirefoxUA()) {
      findings.push(finding('weak', 'Empty navigator.vendor', 'Mainstream desktop browsers usually expose a vendor string.'));
    }

    if (!navigator.languages || navigator.languages.length === 0) {
      findings.push(finding('moderate', 'Empty navigator.languages', 'A real browser profile usually has at least one language.'));
    }

    if (navigator.cookieEnabled === false) {
      findings.push(finding('weak', 'Cookies disabled', 'This is not VM-specific but commonly appears in hardened profiles.'));
    }

    const pluginsLength = navigator.plugins ? navigator.plugins.length : null;
    const mimeTypesLength = navigator.mimeTypes ? navigator.mimeTypes.length : null;
    if (pluginsLength === 0) {
      findings.push(finding('weak', 'No browser plugins', 'Zero plugins is common in headless or stripped-down browser profiles.'));
    }
    if (mimeTypesLength === 0) {
      findings.push(finding('weak', 'No MIME types', 'Zero MIME types is common in headless or stripped-down browser profiles.'));
    }

    if (navigator.pdfViewerEnabled === false) {
      findings.push(finding('weak', 'PDF viewer disabled', 'A disabled PDF viewer is a weak hardening or automation signal.'));
    }

    if (uaData && typeof uaData.mobile === 'boolean') {
      const uaMobile = isMobileUA();
      if (uaData.mobile !== uaMobile) {
        findings.push(finding('moderate', 'UA-CH mobile mismatch', `userAgentData.mobile=${uaData.mobile}, UA mobile=${uaMobile}.`));
      }
    }

    const gpuText = normalizeText(`${raw.webgl.vendor || ''} ${raw.webgl.renderer || ''}`);
    const platform = normalizeText(navigator.platform || '');
    if (platform.includes('mac') && /(direct3d|microsoft|angle)/.test(gpuText)) {
      findings.push(finding('moderate', 'Platform/GPU mismatch', 'Mac platform with Microsoft/Direct3D style renderer.'));
    }
    if (platform.includes('linux') && /direct3d/.test(gpuText)) {
      findings.push(finding('weak', 'Linux platform with Direct3D renderer', 'This can indicate translation or spoofing.'));
    }

    if (/Chrome\//.test(navigator.userAgent) && !window.chrome && !/Edg\//.test(navigator.userAgent)) {
      findings.push(finding('weak', 'Chrome object missing', 'Chrome User-Agent without window.chrome can indicate spoofing.'));
    }

    return {
      summary: findings.length ? `${findings.length} browser identity signal(s)` : 'Navigator profile is coherent',
      raw,
      findings
    };
  }

  async function runPeripheralCheck() {
    const findings = [];
    const battery = await getBatteryInfo();
    const devices = await getMediaDeviceInfo();
    const gamepads = getGamepadInfo();
    const connection = getConnectionInfo();
    const permissions = await getPermissionStates();
    const raw = {
      battery,
      maxTouchPoints: navigator.maxTouchPoints,
      mediaDevices: devices,
      gamepads,
      connection,
      xr: { supported: Boolean(navigator.xr) },
      permissions,
      apiPresence: {
        getBattery: typeof navigator.getBattery === 'function',
        deviceMemory: typeof navigator.deviceMemory === 'number',
        connection: Boolean(navigator.connection || navigator.mozConnection || navigator.webkitConnection)
      }
    };

    if (!raw.apiPresence.getBattery) {
      findings.push(finding(
        isFirefoxUA() ? 'info' : 'weak',
        'Battery API unavailable',
        isFirefoxUA()
          ? 'Firefox does not expose this API in normal desktop builds.'
          : 'The requested signal is unavailable in this browser or context.'
      ));
    } else if (battery && battery.available && battery.level === 1 && battery.charging === true) {
      const sparseHardwareProfile = devices.available && devices.audioinput === 0 && devices.videoinput === 0;
      const lowResourceProfile = (navigator.hardwareConcurrency || 0) > 0 && (navigator.hardwareConcurrency || 0) <= 2;
      findings.push(finding(
        sparseHardwareProfile || lowResourceProfile ? 'moderate' : 'info',
        'Battery reports full and charging',
        sparseHardwareProfile || lowResourceProfile
          ? 'Full+charging battery is suspicious when paired with missing devices or low resources.'
          : 'A plugged-in real laptop can report 100% and charging; this is recorded as context only.'
      ));
    }

    if (isMobileUA() && (navigator.maxTouchPoints || 0) === 0) {
      findings.push(finding('moderate', 'Mobile UA without touch points', 'Mobile browser identity conflicts with maxTouchPoints=0.'));
    }

    if (devices.available && devices.audioinput === 0 && devices.videoinput === 0) {
      findings.push(finding('moderate', 'No audio or video input devices', 'No microphone and no camera together is common in VM and headless profiles.'));
    }

    const virtualGamepad = gamepads.items.find((pad) => /virtual|vbox|vmware|qemu/i.test(pad.id || ''));
    if (virtualGamepad) {
      findings.push(finding('strong', 'Virtual gamepad identifier', virtualGamepad.id));
    }

    if (connection.available && connection.rtt !== null && connection.rtt <= 10 && connection.type === 'ethernet') {
      findings.push(finding('weak', 'Low RTT on ethernet profile', `NetworkInformation reports ethernet and rtt=${connection.rtt}.`));
    }

    if (!raw.apiPresence.getBattery && !raw.apiPresence.deviceMemory && !raw.apiPresence.connection) {
      findings.push(finding(
        isFirefoxUA() ? 'info' : 'weak',
        'Multiple optional hardware APIs unavailable',
        isFirefoxUA()
          ? 'Battery, DeviceMemory, and NetworkInformation are normally unavailable in Firefox and should not count as VM evidence.'
          : 'Battery, DeviceMemory, and NetworkInformation are all missing.'
      ));
    }

    return {
      summary: findings.length ? `${findings.length} peripheral/API signal(s)` : 'Peripheral API profile is normal',
      raw,
      findings
    };
  }

  async function runLocaleCheck() {
    const findings = [];
    const intlOptions = Intl.DateTimeFormat().resolvedOptions();
    const timezone = intlOptions.timeZone || null;
    const intlOffsetMinutes = timezone ? getIntlOffsetMinutes(timezone) : null;
    const dateOffsetMinutes = -new Date().getTimezoneOffset();
    const collator = benchmarkCollator();
    const raw = {
      timezone,
      locale: intlOptions.locale,
      calendar: intlOptions.calendar,
      numberingSystem: intlOptions.numberingSystem,
      navigatorLanguage: navigator.language,
      navigatorLanguages: Array.from(navigator.languages || []),
      intlOffsetMinutes,
      dateOffsetMinutes,
      collator
    };

    if (navigator.languages && navigator.languages[0] && navigator.language && navigator.languages[0] !== navigator.language) {
      findings.push(finding('weak', 'Language order mismatch', `navigator.language=${navigator.language}, first language=${navigator.languages[0]}.`));
    }

    if (!timezone) {
      findings.push(finding('weak', 'Timezone unavailable', 'Intl.DateTimeFormat did not return a timezone.'));
    }

    if (intlOffsetMinutes !== null && Math.abs(intlOffsetMinutes - dateOffsetMinutes) > 60) {
      findings.push(finding('moderate', 'Timezone offset mismatch', `Date offset=${dateOffsetMinutes}, Intl offset=${intlOffsetMinutes}.`));
    }

    if (collator.ms > 180) {
      findings.push(finding('moderate', 'Slow Intl.Collator benchmark', `Sort probe took ${collator.ms.toFixed(2)} ms.`));
    } else if (collator.ms > 90) {
      findings.push(finding('weak', 'Elevated Intl.Collator latency', `Sort probe took ${collator.ms.toFixed(2)} ms.`));
    }

    return {
      summary: findings.length ? `${findings.length} locale/timezone signal(s)` : 'Locale and timezone are coherent',
      raw,
      findings
    };
  }

  async function runTimingCheck() {
    const findings = [];
    const drift = measurePerformanceDrift();
    const raf = await measureRafTiming(60);
    const timeouts = await measureSetTimeoutLatency(100);
    const audio = await getAudioLatencyInfo();
    const cssAnimation = getCssTimingInfo();
    const raw = { drift, raf, setTimeout: timeouts, audio, cssAnimation, documentHidden: document.hidden };

    if (drift.sameValueRatio > 0.95) {
      findings.push(finding(
        drift.minPositiveDelta >= 1 && !isPrivacyHardenedTimer(drift) ? 'weak' : 'info',
        isFirefoxUA() ? 'Firefox timer precision protection' : 'High performance.now drift collisions',
        `${(drift.sameValueRatio * 100).toFixed(1)}% of consecutive calls returned the same value with min delta ${drift.minPositiveDelta.toFixed(3)} ms. Tight-loop collisions are normal when calls are faster than timer resolution.`
      ));
    } else if (drift.sameValueRatio > 0.8) {
      findings.push(finding('info', 'Reduced timing granularity', `${(drift.sameValueRatio * 100).toFixed(1)}% same-value ratio.`));
    }

    if (raf.supported && !document.hidden) {
      if (raf.fps < 30) {
        findings.push(finding('moderate', 'Low requestAnimationFrame FPS', `Measured ${raf.fps.toFixed(1)} fps.`));
      } else if (raf.fps < 45) {
        findings.push(finding('weak', 'Reduced requestAnimationFrame FPS', `Measured ${raf.fps.toFixed(1)} fps.`));
      }
    }

    if (timeouts.stdDev > 10 || timeouts.max > 60) {
      findings.push(finding('moderate', 'Unstable setTimeout latency', `stdDev=${timeouts.stdDev.toFixed(2)} ms, max=${timeouts.max.toFixed(2)} ms.`));
    } else if (timeouts.stdDev < 0.05 && timeouts.mean < 3) {
      findings.push(finding('weak', 'Unnaturally stable setTimeout latency', `mean=${timeouts.mean.toFixed(2)} ms, stdDev=${timeouts.stdDev.toFixed(3)} ms.`));
    }

    if (audio.supported && audio.baseLatency === 0 && (audio.outputLatency === 0 || audio.outputLatency === null)) {
      findings.push(finding(
        isFirefoxUA() ? 'info' : 'weak',
        'Zero AudioContext latency',
        isFirefoxUA()
          ? 'Firefox can expose zero or null latency fields; this is kept as raw context only.'
          : 'Audio latency fields are zero or unavailable.'
      ));
    } else if (!audio.supported) {
      findings.push(finding('weak', 'AudioContext unavailable', 'Modern browsers usually expose AudioContext.'));
    }

    if (!cssAnimation.supported || cssAnimation.durationMs === 0) {
      findings.push(finding('weak', 'CSS transition timing unavailable', 'Computed transition duration returned zero or unsupported.'));
    }

    return {
      summary: findings.length ? `${findings.length} timing signal(s)` : 'Timing probes are within expected ranges',
      raw,
      findings
    };
  }

  async function runCssCheck() {
    const findings = [];
    const supports = getCssSupportsInfo();
    const fonts = getFontRenderingInfo();
    const media = getMediaQueryInfo();
    const raw = { supports, fonts, media };

    if (isModernBrowser() && supports.supportedCount <= 2) {
      findings.push(finding('weak', 'Low modern CSS support count', `${supports.supportedCount}/${supports.total} selected modern features are supported.`));
    }

    if (fonts.uniqueRoundedWidths <= 2 || fonts.spread < 2) {
      findings.push(finding('weak', 'Font metrics are too similar', 'Several system font probes collapsed to nearly identical widths.'));
    }

    if (isDesktopUA() && media.hoverHover === false) {
      findings.push(finding('moderate', 'Desktop UA without hover support', 'matchMedia("(hover: hover)") is false on a desktop profile.'));
    }

    return {
      summary: findings.length ? `${findings.length} CSS/rendering signal(s)` : 'CSS and font rendering look normal',
      raw,
      findings
    };
  }

  async function runNetworkCheck() {
    const findings = [];
    const webrtc = await gatherWebRtcIps();
    const websocket = await measureWebSocketLatency();
    const fetchTiming = await measureFetchLatency();
    const raw = { webrtc, websocket, fetchTiming };

    for (const ip of webrtc.ips || []) {
      const vmRange = classifyVmIp(ip);
      if (vmRange) {
        findings.push(finding(vmRange.severity, 'VM-like private IP range', `${ip} matches ${vmRange.name}.`));
      }
    }

    if (websocket.available && websocket.samples.length >= 3 && websocket.mean < 3 && websocket.stdDev < 0.05) {
      findings.push(finding('weak', 'Unnaturally stable WebSocket RTT', `mean=${websocket.mean.toFixed(2)} ms, stdDev=${websocket.stdDev.toFixed(3)} ms.`));
    }

    if (fetchTiming.available && fetchTiming.samples.length >= 4 && fetchTiming.mean < 3 && fetchTiming.stdDev < 0.05) {
      findings.push(finding('weak', 'Unnaturally stable fetch latency', `mean=${fetchTiming.mean.toFixed(2)} ms, stdDev=${fetchTiming.stdDev.toFixed(3)} ms.`));
    }

    return {
      summary: findings.length ? `${findings.length} network signal(s)` : 'No network VM evidence',
      raw,
      findings
    };
  }

  async function collectRawInventory(report) {
    const tasks = {
      'Navigator': collectRawNavigator,
      'User-Agent Client Hints': collectRawUAHints,
      'Screen / Display': collectRawScreen,
      'Window / Viewport': collectRawWindow,
      'WebGL 1 + 2': collectRawWebGL,
      'WebGPU': collectRawWebGPU,
      'Canvas 2D fingerprint': collectRawCanvas2D,
      'Audio live + offline fingerprint': collectRawAudio,
      'Fonts detected by measurement': collectRawFonts,
      'WebRTC ICE candidates': collectRawWebRTCFull,
      'Media devices and codecs': collectRawMedia,
      'Network': collectRawNetwork,
      'Storage': collectRawStorage,
      'Crypto / Secure Context': collectRawCrypto,
      'Permissions': collectRawPermissions,
      'CSS feature support': collectRawCssSupport,
      'matchMedia display and preferences': collectRawMatchMedia,
      'Battery': collectRawBattery,
      'Gamepads': collectRawGamepads,
      'Time / Locale': collectRawLocale,
      'Performance / Memory': collectRawPerformance,
      'Modern Web APIs availability': collectRawApis,
      'Keyboard layout': collectRawKeyboardLayout,
      'Speech synthesis voices': collectRawSpeech,
      'Server-side HTTP view': collectRawServerSide
    };

    const entries = await Promise.all(Object.entries(tasks).map(async ([name, fn]) => {
      try {
        return [name, await fn()];
      } catch (error) {
        return [name, { error: error && error.message ? error.message : String(error) }];
      }
    }));

    return {
      generatedAt: new Date().toISOString(),
      app: 'virtual-machine-detector',
      note: 'Browser-visible inventory only. Native CPU model, SMBIOS, PCI IDs, disk serials, RAM modules, and CPUID hypervisor bits are not exposed to browser JavaScript.',
      score: report ? report.score : null,
      verdict: report ? report.verdict : null,
      categories: Object.fromEntries(entries)
    };
  }

  function collectRawNavigator() {
    const keys = [
      'userAgent',
      'appName',
      'appVersion',
      'appCodeName',
      'product',
      'productSub',
      'platform',
      'vendor',
      'vendorSub',
      'language',
      'languages',
      'cookieEnabled',
      'doNotTrack',
      'globalPrivacyControl',
      'hardwareConcurrency',
      'deviceMemory',
      'maxTouchPoints',
      'webdriver',
      'pdfViewerEnabled',
      'onLine',
      'oscpu',
      'buildID',
      'standalone'
    ];
    const data = {};
    for (const key of keys) {
      if (key in navigator) {
        data[key] = navigator[key];
      }
    }
    if (navigator.userAgentData) {
      data.userAgentData = {
        brands: navigator.userAgentData.brands,
        mobile: navigator.userAgentData.mobile,
        platform: navigator.userAgentData.platform
      };
    }
    return data;
  }

  async function collectRawUAHints() {
    if (!navigator.userAgentData || typeof navigator.userAgentData.getHighEntropyValues !== 'function') {
      return { available: false, note: 'navigator.userAgentData is unavailable in this browser.' };
    }
    try {
      return {
        available: true,
        highEntropy: await navigator.userAgentData.getHighEntropyValues([
          'architecture',
          'bitness',
          'model',
          'platformVersion',
          'uaFullVersion',
          'wow64',
          'fullVersionList',
          'formFactor'
        ])
      };
    } catch (error) {
      return { available: true, error: error.message };
    }
  }

  function collectRawScreen() {
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      availLeft: screen.availLeft,
      availTop: screen.availTop,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      isExtended: screen.isExtended,
      orientation: screen.orientation ? {
        type: screen.orientation.type,
        angle: screen.orientation.angle
      } : null
    };
  }

  function collectRawWindow() {
    const out = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      screenLeft: window.screenLeft,
      screenTop: window.screenTop,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
    if (window.visualViewport) {
      out.visualViewport = {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
        pageLeft: window.visualViewport.pageLeft,
        pageTop: window.visualViewport.pageTop
      };
    }
    return out;
  }

  function collectRawWebGL() {
    const out = {};
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      out.webgl1 = gl ? dumpRawGl(gl, false) : null;
    } catch (error) {
      out.webgl1 = { error: error.message };
    }
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      out.webgl2 = gl ? dumpRawGl(gl, true) : null;
    } catch (error) {
      out.webgl2 = { error: error.message };
    }
    return out;
  }

  function dumpRawGl(gl, isWebGl2) {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const data = {
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null
    };

    const params = [
      'MAX_TEXTURE_SIZE',
      'MAX_VIEWPORT_DIMS',
      'MAX_RENDERBUFFER_SIZE',
      'MAX_VERTEX_ATTRIBS',
      'MAX_VARYING_VECTORS',
      'MAX_VERTEX_UNIFORM_VECTORS',
      'MAX_FRAGMENT_UNIFORM_VECTORS',
      'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
      'MAX_CUBE_MAP_TEXTURE_SIZE',
      'ALIASED_LINE_WIDTH_RANGE',
      'ALIASED_POINT_SIZE_RANGE',
      'RED_BITS',
      'GREEN_BITS',
      'BLUE_BITS',
      'ALPHA_BITS',
      'DEPTH_BITS',
      'STENCIL_BITS',
      'SUBPIXEL_BITS',
      'SAMPLE_BUFFERS',
      'SAMPLES'
    ];
    if (isWebGl2) {
      params.push(
        'MAX_3D_TEXTURE_SIZE',
        'MAX_ARRAY_TEXTURE_LAYERS',
        'MAX_COLOR_ATTACHMENTS',
        'MAX_DRAW_BUFFERS',
        'MAX_ELEMENTS_INDICES',
        'MAX_ELEMENTS_VERTICES',
        'MAX_FRAGMENT_INPUT_COMPONENTS',
        'MAX_FRAGMENT_UNIFORM_BLOCKS',
        'MAX_FRAGMENT_UNIFORM_COMPONENTS',
        'MAX_PROGRAM_TEXEL_OFFSET',
        'MAX_SAMPLES',
        'MAX_SERVER_WAIT_TIMEOUT',
        'MAX_TEXTURE_LOD_BIAS',
        'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
        'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
        'MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS',
        'MAX_UNIFORM_BLOCK_SIZE',
        'MAX_UNIFORM_BUFFER_BINDINGS',
        'MAX_VARYING_COMPONENTS',
        'MAX_VERTEX_OUTPUT_COMPONENTS',
        'MAX_VERTEX_UNIFORM_BLOCKS',
        'MAX_VERTEX_UNIFORM_COMPONENTS',
        'MIN_PROGRAM_TEXEL_OFFSET'
      );
    }
    for (const param of params) {
      try {
        const value = gl.getParameter(gl[param]);
        data[param] = value && value.length !== undefined && typeof value !== 'string' ? Array.from(value) : value;
      } catch (error) {
        data[param] = null;
      }
    }

    data.extensions = gl.getSupportedExtensions() || [];
    data.shaderPrecision = {};
    for (const stageName of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      data.shaderPrecision[stageName] = {};
      for (const precisionName of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) {
        try {
          const precision = gl.getShaderPrecisionFormat(gl[stageName], gl[precisionName]);
          data.shaderPrecision[stageName][precisionName] = {
            rangeMin: precision.rangeMin,
            rangeMax: precision.rangeMax,
            precision: precision.precision
          };
        } catch (error) {
          data.shaderPrecision[stageName][precisionName] = null;
        }
      }
    }
    return data;
  }

  async function collectRawWebGPU() {
    if (!('gpu' in navigator)) {
      return { available: false };
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return { available: true, adapter: null };
      }
      const out = {
        available: true,
        isFallbackAdapter: adapter.isFallbackAdapter,
        features: Array.from(adapter.features || [])
      };
      if (adapter.info) {
        out.info = {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description
        };
      } else if (typeof adapter.requestAdapterInfo === 'function') {
        try {
          const info = await adapter.requestAdapterInfo();
          out.info = {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description
          };
        } catch (error) {
          out.infoError = error.message;
        }
      }
      if (adapter.limits) {
        out.limits = {};
        for (const key in adapter.limits) {
          try {
            out.limits[key] = adapter.limits[key];
          } catch (error) {
            out.limits[key] = null;
          }
        }
      }
      return out;
    } catch (error) {
      return { available: true, error: error.message };
    }
  }

  function collectRawCanvas2D() {
    return getCanvasFingerprint();
  }

  async function collectRawAudio() {
    const out = {};
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        const context = new AudioContextClass();
        out.live = {
          sampleRate: context.sampleRate,
          baseLatency: context.baseLatency,
          outputLatency: context.outputLatency,
          state: context.state
        };
        try {
          await context.close();
        } catch (error) {
          out.liveCloseError = error.message;
        }
      } catch (error) {
        out.live = { error: error.message };
      }
    } else {
      out.live = { available: false };
    }

    const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineAudioContextClass) {
      try {
        const context = new OfflineAudioContextClass(1, 44100, 44100);
        const oscillator = context.createOscillator();
        const compressor = context.createDynamicsCompressor();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 10000;
        oscillator.connect(compressor);
        compressor.connect(context.destination);
        oscillator.start();
        const buffer = await context.startRendering();
        const channel = buffer.getChannelData(0);
        let sum = 0;
        for (let i = 4500; i < 5000; i += 1) {
          sum += Math.abs(channel[i] || 0);
        }
        out.offlineFingerprint = {
          samplesSum4500To5000: Number(sum.toFixed(8)),
          length: buffer.length,
          sampleRate: buffer.sampleRate
        };
      } catch (error) {
        out.offlineFingerprint = { error: error.message };
      }
    } else {
      out.offlineFingerprint = { available: false };
    }
    return out;
  }

  async function collectRawFonts() {
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const testFonts = [
      'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
      'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
      'Ebrima', 'Franklin Gothic', 'Georgia', 'Impact', 'Lucida Console',
      'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype',
      'Segoe Print', 'Segoe Script', 'Segoe UI', 'Symbol', 'Tahoma',
      'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
      'American Typewriter', 'Andale Mono', 'Apple Color Emoji', 'Avenir',
      'Baskerville', 'Charter', 'Courier', 'Futura', 'Geneva', 'Gill Sans',
      'Helvetica', 'Helvetica Neue', 'Menlo', 'Monaco', 'Optima', 'Palatino',
      'Times', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
      'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Ubuntu',
      'Ubuntu Mono', 'Cantarell', 'Roboto', 'Roboto Mono', 'Noto Sans',
      'Noto Serif', 'Open Sans', 'Inter', 'Source Code Pro', 'Fira Code',
      'JetBrains Mono', 'Inconsolata', 'Lato', 'Montserrat', 'Poppins'
    ];
    const text = 'mmmmmmmmmmlli';
    const fontSize = '72px';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const baselineWidths = {};
    for (const baseFont of baseFonts) {
      context.font = `${fontSize} ${baseFont}`;
      baselineWidths[baseFont] = context.measureText(text).width;
    }

    const detected = [];
    for (const font of testFonts) {
      let matched = false;
      for (const baseFont of baseFonts) {
        context.font = `${fontSize} "${font}", ${baseFont}`;
        if (context.measureText(text).width !== baselineWidths[baseFont]) {
          matched = true;
          break;
        }
      }
      if (matched) {
        detected.push(font);
      }
    }
    return {
      tested: testFonts.length,
      detectedCount: detected.length,
      detected,
      baselineWidths
    };
  }

  async function collectRawWebRTCFull() {
    const PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!PeerConnection) {
      return { available: false };
    }
    const peer = new PeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const candidates = [];
    const ips = new Set();
    const hostnames = new Set();
    peer.createDataChannel('raw-inventory');
    const done = new Promise((resolve) => {
      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          resolve();
          return;
        }
        const candidate = event.candidate.candidate;
        candidates.push(candidate);
        for (const ip of candidate.match(/(?:\d{1,3}\.){3}\d{1,3}/g) || []) {
          ips.add(ip);
        }
        for (const host of candidate.match(/[a-z0-9-]+\.local/gi) || []) {
          hostnames.add(host);
        }
      };
      setTimeout(resolve, 1500);
    });
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await done;
      return {
        available: true,
        candidates,
        ips: Array.from(ips),
        hostnames: Array.from(hostnames)
      };
    } catch (error) {
      return { available: true, error: error.message };
    } finally {
      peer.close();
    }
  }

  async function collectRawMedia() {
    const out = {};
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        out.devices = devices.map((device) => ({
          kind: device.kind,
          hasLabel: Boolean(device.label),
          groupIdPresent: Boolean(device.groupId),
          deviceIdPresent: Boolean(device.deviceId)
        }));
        out.deviceCounts = devices.reduce((acc, device) => {
          acc[device.kind] = (acc[device.kind] || 0) + 1;
          return acc;
        }, {});
      } catch (error) {
        out.devices = { error: error.message };
      }
    }

    if (window.MediaSource && MediaSource.isTypeSupported) {
      const codecs = [
        'video/mp4; codecs="avc1.42E01E"',
        'video/mp4; codecs="avc1.640028"',
        'video/mp4; codecs="hev1.1.6.L93.B0"',
        'video/webm; codecs="vp8"',
        'video/webm; codecs="vp9"',
        'video/webm; codecs="av01.0.05M.08"',
        'video/mp4; codecs="av01.0.05M.08"',
        'audio/mp4; codecs="mp4a.40.2"',
        'audio/webm; codecs="opus"',
        'audio/webm; codecs="vorbis"',
        'audio/ogg; codecs="opus"',
        'audio/flac'
      ];
      out.mediaSourceSupport = {};
      for (const codec of codecs) {
        try {
          out.mediaSourceSupport[codec] = MediaSource.isTypeSupported(codec);
        } catch (error) {
          out.mediaSourceSupport[codec] = false;
        }
      }
    }

    const video = document.createElement('video');
    out.videoCanPlayType = {};
    for (const type of ['video/mp4', 'video/webm', 'video/ogg', 'application/vnd.apple.mpegurl', 'application/x-mpegURL']) {
      try {
        out.videoCanPlayType[type] = video.canPlayType(type);
      } catch (error) {
        out.videoCanPlayType[type] = '';
      }
    }
    return out;
  }

  async function collectRawNetwork() {
    const out = {};
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      out.connection = {
        type: connection.type,
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        downlinkMax: connection.downlinkMax,
        rtt: connection.rtt,
        saveData: connection.saveData
      };
    }
    out.fetchPing = await measureFetchLatency();
    return out;
  }

  async function collectRawStorage() {
    const out = {
      localStorage: Boolean(window.localStorage),
      sessionStorage: Boolean(window.sessionStorage),
      indexedDB: Boolean(window.indexedDB),
      caches: Boolean(window.caches),
      serviceWorker: Boolean(navigator.serviceWorker),
      cookieEnabled: navigator.cookieEnabled
    };
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        out.estimate = await navigator.storage.estimate();
      } catch (error) {
        out.estimate = { error: error.message };
      }
    }
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      try {
        out.persisted = await navigator.storage.persisted();
      } catch (error) {
        out.persisted = null;
      }
    }
    return out;
  }

  function collectRawCrypto() {
    return {
      cryptoAvailable: Boolean(window.crypto),
      subtle: Boolean(window.crypto && window.crypto.subtle),
      randomUUID: Boolean(window.crypto && window.crypto.randomUUID),
      isSecureContext: Boolean(window.isSecureContext),
      crossOriginIsolated: Boolean(window.crossOriginIsolated)
    };
  }

  async function collectRawPermissions() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return { available: false };
    }
    const names = [
      'geolocation',
      'notifications',
      'persistent-storage',
      'push',
      'midi',
      'camera',
      'microphone',
      'background-fetch',
      'background-sync',
      'ambient-light-sensor',
      'accelerometer',
      'gyroscope',
      'magnetometer',
      'screen-wake-lock',
      'clipboard-read',
      'clipboard-write',
      'payment-handler',
      'idle-detection',
      'periodic-background-sync',
      'system-wake-lock',
      'storage-access',
      'window-placement',
      'window-management'
    ];
    const out = {};
    for (const name of names) {
      try {
        const result = await navigator.permissions.query({ name });
        out[name] = result.state;
      } catch (error) {
        out[name] = 'unsupported';
      }
    }
    if (typeof Notification !== 'undefined') {
      out.NotificationPermission = Notification.permission;
    }
    return out;
  }

  function collectRawCssSupport() {
    if (!window.CSS || typeof CSS.supports !== 'function') {
      return { available: false };
    }
    const features = {
      'display grid': 'display: grid',
      'display flex': 'display: flex',
      'display subgrid': 'grid-template-rows: subgrid',
      'backdrop-filter': 'backdrop-filter: blur(2px)',
      'container-type': 'container-type: inline-size',
      'color-mix': 'color: color-mix(in srgb, red, blue)',
      'has selector': 'selector(:has(+ *))',
      'focus-visible selector': 'selector(:focus-visible)',
      'aspect-ratio': 'aspect-ratio: 1/1',
      'scroll-behavior smooth': 'scroll-behavior: smooth',
      'image-set': 'background-image: image-set(url("x") 1x)',
      'overflow clip': 'overflow: clip',
      'inset': 'inset: 0',
      'accent-color': 'accent-color: red',
      'forced-colors': '(forced-colors: active)',
      'prefers-color-scheme dark': '(prefers-color-scheme: dark)',
      'prefers-reduced-motion': '(prefers-reduced-motion: reduce)',
      'scope selector': 'selector(:scope)',
      'anchor positioning': 'anchor-name: --x',
      'view-transition-name': 'view-transition-name: x'
    };
    const out = {};
    for (const [name, query] of Object.entries(features)) {
      try {
        out[name] = CSS.supports(query);
      } catch (error) {
        out[name] = null;
      }
    }
    return out;
  }

  function collectRawMatchMedia() {
    const queries = [
      '(hover: hover)',
      '(hover: none)',
      '(any-hover: hover)',
      '(any-hover: none)',
      '(pointer: fine)',
      '(pointer: coarse)',
      '(pointer: none)',
      '(any-pointer: fine)',
      '(any-pointer: coarse)',
      '(prefers-color-scheme: dark)',
      '(prefers-color-scheme: light)',
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(prefers-contrast: more)',
      '(prefers-contrast: less)',
      '(forced-colors: active)',
      '(inverted-colors: inverted)',
      '(color-gamut: srgb)',
      '(color-gamut: p3)',
      '(color-gamut: rec2020)',
      '(dynamic-range: high)',
      '(video-dynamic-range: high)',
      '(display-mode: standalone)',
      '(display-mode: browser)',
      '(display-mode: fullscreen)',
      '(orientation: portrait)',
      '(orientation: landscape)',
      '(scripting: enabled)',
      '(update: fast)',
      '(update: slow)'
    ];
    const out = {};
    for (const query of queries) {
      try {
        out[query] = window.matchMedia(query).matches;
      } catch (error) {
        out[query] = null;
      }
    }
    return out;
  }

  async function collectRawBattery() {
    return getBatteryInfo();
  }

  function collectRawGamepads() {
    return getGamepadInfo();
  }

  function collectRawLocale() {
    const options = Intl.DateTimeFormat().resolvedOptions();
    return {
      timezone: options.timeZone,
      locale: options.locale,
      calendar: options.calendar,
      numberingSystem: options.numberingSystem,
      dateTimeFormat: options,
      dateTimezoneOffset: new Date().getTimezoneOffset(),
      dateToString: new Date().toString(),
      dateToISOString: new Date().toISOString(),
      navigatorLanguage: navigator.language,
      navigatorLanguages: Array.from(navigator.languages || [])
    };
  }

  function collectRawPerformance() {
    const out = {
      timeOrigin: performance.timeOrigin
    };
    if (performance.memory) {
      out.memory = {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
    }
    if (performance.navigation) {
      out.navigation = {
        type: performance.navigation.type,
        redirectCount: performance.navigation.redirectCount
      };
    }
    try {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        out.navigationEntry = {
          type: navigation.type,
          transferSize: navigation.transferSize,
          encodedBodySize: navigation.encodedBodySize,
          decodedBodySize: navigation.decodedBodySize,
          responseStart: navigation.responseStart,
          domComplete: navigation.domComplete,
          loadEventEnd: navigation.loadEventEnd,
          nextHopProtocol: navigation.nextHopProtocol
        };
      }
    } catch (error) {
      out.navigationEntryError = error.message;
    }
    return out;
  }

  function collectRawApis() {
    return {
      Accelerometer: 'Accelerometer' in window,
      Gyroscope: 'Gyroscope' in window,
      Magnetometer: 'Magnetometer' in window,
      AmbientLightSensor: 'AmbientLightSensor' in window,
      LinearAccelerationSensor: 'LinearAccelerationSensor' in window,
      AbsoluteOrientationSensor: 'AbsoluteOrientationSensor' in window,
      RelativeOrientationSensor: 'RelativeOrientationSensor' in window,
      DeviceMotionEvent: 'DeviceMotionEvent' in window,
      DeviceOrientationEvent: 'DeviceOrientationEvent' in window,
      'navigator.bluetooth': 'bluetooth' in navigator,
      'navigator.usb': 'usb' in navigator,
      'navigator.serial': 'serial' in navigator,
      'navigator.hid': 'hid' in navigator,
      'navigator.nfc': 'nfc' in navigator,
      'navigator.xr': 'xr' in navigator,
      'navigator.share': 'share' in navigator,
      'navigator.clipboard': 'clipboard' in navigator,
      'navigator.contacts': 'contacts' in navigator,
      'navigator.scheduling': 'scheduling' in navigator,
      'navigator.locks': 'locks' in navigator,
      'navigator.wakeLock': 'wakeLock' in navigator,
      'navigator.keyboard': 'keyboard' in navigator,
      'navigator.windowControlsOverlay': 'windowControlsOverlay' in navigator,
      'navigator.virtualKeyboard': 'virtualKeyboard' in navigator,
      'navigator.gpu': 'gpu' in navigator,
      'navigator.ink': 'ink' in navigator,
      PaymentRequest: 'PaymentRequest' in window,
      PushManager: 'PushManager' in window,
      Notification: 'Notification' in window,
      BroadcastChannel: 'BroadcastChannel' in window,
      ServiceWorker: 'serviceWorker' in navigator,
      SharedWorker: 'SharedWorker' in window,
      FileSystemHandle: 'FileSystemHandle' in window,
      showOpenFilePicker: 'showOpenFilePicker' in window,
      EyeDropper: 'EyeDropper' in window,
      LaunchQueue: 'launchQueue' in window,
      SharedArrayBuffer: 'SharedArrayBuffer' in window,
      WebAssembly: 'WebAssembly' in window,
      IdleDetector: 'IdleDetector' in window,
      CompressionStream: 'CompressionStream' in window,
      URLPattern: 'URLPattern' in window,
      OffscreenCanvas: 'OffscreenCanvas' in window,
      ResizeObserver: 'ResizeObserver' in window,
      IntersectionObserver: 'IntersectionObserver' in window,
      PerformanceObserver: 'PerformanceObserver' in window
    };
  }

  async function collectRawKeyboardLayout() {
    if (navigator.keyboard && typeof navigator.keyboard.getLayoutMap === 'function') {
      try {
        const layout = await navigator.keyboard.getLayoutMap();
        const out = {};
        for (const [key, value] of layout.entries()) {
          out[key] = value;
        }
        return {
          available: true,
          layoutSize: Object.keys(out).length,
          layout: out
        };
      } catch (error) {
        return { available: true, error: error.message };
      }
    }
    return { available: false };
  }

  async function collectRawSpeech() {
    if (!window.speechSynthesis) {
      return { available: false };
    }
    let voices = window.speechSynthesis.getVoices();
    if (!voices.length) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 400);
        window.speechSynthesis.onvoiceschanged = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      voices = window.speechSynthesis.getVoices();
    }
    return {
      available: true,
      count: voices.length,
      voices: voices.map((voice) => ({
        name: voice.name,
        lang: voice.lang,
        default: voice.default,
        localService: voice.localService,
        voiceURI: voice.voiceURI
      }))
    };
  }

  async function collectRawServerSide() {
    if (isStaticPagesMode()) {
      return {
        available: false,
        skipped: true,
        reason: 'GitHub Pages serves static files only; Express /inspect is unavailable.'
      };
    }
    try {
      const response = await fetch(apiPath('/inspect'), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      return { error: error.message };
    }
  }

  function isStaticPagesMode() {
    const hostname = (location.hostname || '').toLowerCase();
    return location.protocol === 'file:' || hostname === 'github.io' || hostname.endsWith('.github.io');
  }

  function apiPath(path) {
    return path.startsWith('/') ? path : `/${path}`;
  }

  function finding(severity, title, detail) {
    return {
      severity,
      title,
      detail: detail || ''
    };
  }

  function getWebGLInfo(contextName) {
    if (webglInfoCache.has(contextName)) {
      return webglInfoCache.get(contextName);
    }

    const canvas = document.createElement('canvas');
    let gl = null;
    try {
      gl = canvas.getContext(contextName, {
        alpha: false,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance'
      });
    } catch (error) {
      const unsupported = { supported: false, error: error.message };
      webglInfoCache.set(contextName, unsupported);
      return unsupported;
    }

    if (!gl) {
      const unsupported = { supported: false };
      webglInfoCache.set(contextName, unsupported);
      return unsupported;
    }

    const read = (param) => {
      try {
        const value = gl.getParameter(param);
        return ArrayBuffer.isView(value) ? Array.from(value) : value;
      } catch (error) {
        return null;
      }
    };

    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const params = {
      maxTextureSize: read(gl.MAX_TEXTURE_SIZE),
      maxViewportDims: read(gl.MAX_VIEWPORT_DIMS),
      maxRenderbufferSize: read(gl.MAX_RENDERBUFFER_SIZE),
      maxCombinedTextureImageUnits: read(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)
    };

    const info = {
      supported: true,
      context: contextName,
      vendor: read(gl.VENDOR),
      renderer: read(gl.RENDERER),
      version: read(gl.VERSION),
      shadingLanguageVersion: read(gl.SHADING_LANGUAGE_VERSION),
      unmaskedVendor: debug ? read(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? read(debug.UNMASKED_RENDERER_WEBGL) : null,
      debugRendererInfo: Boolean(debug),
      params,
      extensionsCount: (gl.getSupportedExtensions() || []).length
    };
    webglInfoCache.set(contextName, info);
    return info;
  }

  function getCanvasFingerprint() {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 360, 180);
    gradient.addColorStop(0, '#19c6a7');
    gradient.addColorStop(0.5, '#f6b547');
    gradient.addColorStop(1, '#4f8cff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(239, 91, 91, 0.72)';
    ctx.beginPath();
    ctx.arc(76, 72, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = '#101112';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(18, 150);
    ctx.bezierCurveTo(96, 24, 184, 188, 342, 34);
    ctx.stroke();

    ctx.font = '700 28px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('VM scan \u{1F4BB} 0123', 28, 72);
    ctx.font = '17px Georgia, serif';
    ctx.fillStyle = 'rgba(16, 17, 18, 0.82)';
    ctx.fillText('AaBbYyZz - canvas fingerprint', 32, 118);

    const dataUrl = canvas.toDataURL('image/png');
    return {
      width: canvas.width,
      height: canvas.height,
      dataUrlLength: dataUrl.length,
      hash: hashString(dataUrl)
    };
  }

  function benchmarkEmptyLoop() {
    let acc = 0;
    const started = performance.now();
    for (let i = 0; i < 1000000; i += 1) {
      acc += i & 1;
    }
    return { ms: performance.now() - started, acc };
  }

  function benchmarkSqrtLoop() {
    let acc = 0;
    const started = performance.now();
    for (let i = 1; i <= 100000; i += 1) {
      acc += Math.sqrt(i);
    }
    return { ms: performance.now() - started, acc: Number(acc.toFixed(3)) };
  }

  function measurePerformancePrecision() {
    const deltas = [];
    let same = 0;
    let prev = performance.now();
    for (let i = 0; i < 2000; i += 1) {
      const now = performance.now();
      if (now === prev) {
        same += 1;
      } else {
        deltas.push(now - prev);
      }
      prev = now;
    }
    const minPositiveDelta = deltas.length ? Math.min(...deltas) : 0;
    return {
      samples: 2000,
      sameValues: same,
      sameValueRatio: same / 2000,
      minPositiveDelta,
      meanPositiveDelta: deltas.length ? mean(deltas) : 0
    };
  }

  function measurePerformanceDrift() {
    let same = 0;
    let prev = performance.now();
    const values = [];
    const deltas = [];
    for (let i = 0; i < 1000; i += 1) {
      const now = performance.now();
      values.push(now);
      if (now === prev) {
        same += 1;
      } else {
        deltas.push(now - prev);
      }
      prev = now;
    }
    return {
      samples: values.length,
      sameValues: same,
      sameValueRatio: same / values.length,
      minPositiveDelta: deltas.length ? Math.min(...deltas) : 0,
      meanPositiveDelta: deltas.length ? mean(deltas) : 0,
      first: values[0],
      last: values[values.length - 1]
    };
  }

  function benchmarkSharedArrayBuffer() {
    if (typeof SharedArrayBuffer !== 'function' || typeof Atomics !== 'object') {
      return { available: false, reason: 'SharedArrayBuffer or Atomics unavailable' };
    }

    try {
      const buffer = new SharedArrayBuffer(4);
      const view = new Int32Array(buffer);
      const started = performance.now();
      for (let i = 0; i < 100000; i += 1) {
        Atomics.add(view, 0, 1);
      }
      return { available: true, ms: performance.now() - started, value: Atomics.load(view, 0) };
    } catch (error) {
      return { available: false, reason: error.message };
    }
  }

  function estimateWorkerThroughput(hardwareConcurrency) {
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || !URL.createObjectURL) {
      return Promise.resolve({ supported: false, reason: 'Worker or Blob URL unavailable' });
    }

    const workers = Math.max(1, Math.min(hardwareConcurrency || 2, 8));
    const code = [
      'self.onmessage = function (event) {',
      '  var loops = event.data.loops;',
      '  var acc = 0;',
      '  var started = performance.now();',
      '  for (var i = 1; i <= loops; i += 1) { acc += Math.sqrt(i); }',
      '  self.postMessage({ elapsed: performance.now() - started, acc: acc });',
      '};'
    ].join('\n');
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));

    return new Promise((resolve) => {
      const started = performance.now();
      const results = [];
      const workerRefs = [];
      let settled = false;

      const finish = (reason) => {
        if (settled) {
          return;
        }
        settled = true;
        for (const worker of workerRefs) {
          worker.terminate();
        }
        URL.revokeObjectURL(url);
        resolve({
          supported: true,
          requestedWorkers: workers,
          completedWorkers: results.length,
          totalMs: performance.now() - started,
          reason: reason || 'complete',
          results
        });
      };

      const timer = setTimeout(() => finish('timeout'), 2200);
      for (let i = 0; i < workers; i += 1) {
        const worker = new Worker(url);
        workerRefs.push(worker);
        worker.onmessage = (event) => {
          results.push(event.data);
          if (results.length === workers) {
            clearTimeout(timer);
            finish('complete');
          }
        };
        worker.onerror = () => {
          clearTimeout(timer);
          finish('worker-error');
        };
        worker.postMessage({ loops: 120000 });
      }
    });
  }

  function getPerformanceMemory() {
    if (!performance.memory) {
      return null;
    }
    return {
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      usedJSHeapSize: performance.memory.usedJSHeapSize
    };
  }

  function benchmarkAllocation() {
    try {
      const length = 4 * 1024 * 1024;
      const started = performance.now();
      const array = new Float32Array(length);
      for (let i = 0; i < array.length; i += 1) {
        array[i] = (i % 1024) / 1024;
      }
      let checksum = 0;
      for (let i = 0; i < array.length; i += 131071) {
        checksum += array[i];
      }
      return { bytes: array.byteLength, ms: performance.now() - started, checksum: Number(checksum.toFixed(4)) };
    } catch (error) {
      return { error: error.message };
    }
  }

  async function estimateStorage() {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
      return { available: false };
    }
    try {
      const estimate = await navigator.storage.estimate();
      return {
        available: true,
        usage: estimate.usage || null,
        quota: estimate.quota || null
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async function getUserAgentData() {
    if (!navigator.userAgentData) {
      return null;
    }
    const data = {
      brands: navigator.userAgentData.brands || [],
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform
    };
    if (typeof navigator.userAgentData.getHighEntropyValues === 'function') {
      try {
        data.highEntropy = await navigator.userAgentData.getHighEntropyValues([
          'architecture',
          'bitness',
          'model',
          'platformVersion',
          'uaFullVersion',
          'fullVersionList'
        ]);
      } catch (error) {
        data.highEntropyError = error.message;
      }
    }
    return data;
  }

  async function getBatteryInfo() {
    if (typeof navigator.getBattery !== 'function') {
      return { available: false };
    }
    try {
      const battery = await withTimeout(navigator.getBattery(), 1600, { timedOut: true });
      if (battery.timedOut) {
        return { available: false, timedOut: true };
      }
      return {
        available: true,
        charging: battery.charging,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
        level: battery.level
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  async function getMediaDeviceInfo() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      return { available: false, reason: 'enumerateDevices unavailable' };
    }
    try {
      const devices = await withTimeout(navigator.mediaDevices.enumerateDevices(), 1800, []);
      const counts = devices.reduce((acc, device) => {
        acc[device.kind] = (acc[device.kind] || 0) + 1;
        return acc;
      }, {});
      return {
        available: true,
        total: devices.length,
        audioinput: counts.audioinput || 0,
        audiooutput: counts.audiooutput || 0,
        videoinput: counts.videoinput || 0,
        kinds: counts
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  function getGamepadInfo() {
    if (typeof navigator.getGamepads !== 'function') {
      return { available: false };
    }
    try {
      const items = Array.from(navigator.getGamepads() || [])
        .filter(Boolean)
        .map((pad) => ({
          id: pad.id,
          index: pad.index,
          connected: pad.connected,
          mapping: pad.mapping,
          axes: pad.axes.length,
          buttons: pad.buttons.length
        }));
      return { available: true, count: items.length, items };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  function getConnectionInfo() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) {
      return { available: false };
    }
    return {
      available: true,
      effectiveType: connection.effectiveType || null,
      type: connection.type || null,
      downlink: typeof connection.downlink === 'number' ? connection.downlink : null,
      rtt: typeof connection.rtt === 'number' ? connection.rtt : null,
      saveData: Boolean(connection.saveData)
    };
  }

  async function getPermissionStates() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return { available: false };
    }

    const names = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read'];
    const states = {};
    await Promise.all(names.map(async (name) => {
      try {
        const result = await navigator.permissions.query({ name });
        states[name] = result.state;
      } catch (error) {
        states[name] = `unsupported: ${error.name || error.message}`;
      }
    }));
    return { available: true, states };
  }

  function getIntlOffsetMinutes(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
        hour: '2-digit',
        minute: '2-digit'
      }).formatToParts(new Date());
      const zone = parts.find((part) => part.type === 'timeZoneName');
      if (!zone || zone.value === 'GMT') {
        return 0;
      }
      const match = zone.value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
      if (!match) {
        return null;
      }
      const sign = match[1] === '-' ? -1 : 1;
      const hours = Number(match[2] || 0);
      const minutes = Number(match[3] || 0);
      return sign * ((hours * 60) + minutes);
    } catch (error) {
      return null;
    }
  }

  function benchmarkCollator() {
    const collator = new Intl.Collator(navigator.language || 'en', { sensitivity: 'variant', numeric: true });
    const items = [];
    for (let i = 0; i < 1500; i += 1) {
      items.push(`zeta-${i % 97}-Å-${1500 - i}`);
      items.push(`alpha-${i % 83}-ß-${i}`);
    }
    const started = performance.now();
    items.sort(collator.compare);
    return {
      items: items.length,
      ms: performance.now() - started,
      first: items[0],
      last: items[items.length - 1]
    };
  }

  function measureRafTiming(frames) {
    if (typeof requestAnimationFrame !== 'function') {
      return Promise.resolve({ supported: false });
    }

    return new Promise((resolve) => {
      const timestamps = [];
      let timeout = null;
      const finish = (reason) => {
        clearTimeout(timeout);
        if (timestamps.length < 2) {
          resolve({ supported: true, frames: timestamps.length, fps: 0, reason });
          return;
        }
        const duration = timestamps[timestamps.length - 1] - timestamps[0];
        resolve({
          supported: true,
          frames: timestamps.length,
          duration,
          fps: ((timestamps.length - 1) / duration) * 1000,
          reason: reason || 'complete'
        });
      };

      timeout = setTimeout(() => finish('timeout'), 3500);
      const tick = (ts) => {
        timestamps.push(ts);
        if (timestamps.length >= frames) {
          finish('complete');
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function measureSetTimeoutLatency(count) {
    return new Promise((resolve) => {
      const samples = [];
      const run = () => {
        const started = performance.now();
        setTimeout(() => {
          samples.push(performance.now() - started);
          if (samples.length >= count) {
            resolve(summarizeSamples(samples));
          } else {
            run();
          }
        }, 1);
      };
      run();
    });
  }

  async function getAudioLatencyInfo() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return { supported: false };
    }
    try {
      const context = new AudioContextClass({ latencyHint: 'interactive' });
      const info = {
        supported: true,
        state: context.state,
        sampleRate: context.sampleRate,
        baseLatency: typeof context.baseLatency === 'number' ? context.baseLatency : null,
        outputLatency: typeof context.outputLatency === 'number' ? context.outputLatency : null
      };
      await context.close();
      return info;
    } catch (error) {
      return { supported: false, error: error.message };
    }
  }

  function getCssTimingInfo() {
    try {
      const element = document.createElement('div');
      element.style.position = 'absolute';
      element.style.left = '-9999px';
      element.style.opacity = '0';
      element.style.transition = 'opacity 123ms linear';
      document.body.append(element);
      const computed = getComputedStyle(element);
      const duration = computed.transitionDuration;
      element.remove();
      return {
        supported: true,
        transitionDuration: duration,
        durationMs: parseCssTime(duration)
      };
    } catch (error) {
      return { supported: false, error: error.message };
    }
  }

  function getCssSupportsInfo() {
    const probes = [
      ['font-variation-settings', '"wght" 600'],
      ['backdrop-filter', 'blur(2px)'],
      ['content-visibility', 'auto'],
      ['container-type', 'inline-size'],
      ['accent-color', 'auto'],
      ['selector(:has(*))', '']
    ];

    const results = {};
    let supportedCount = 0;
    for (const [property, value] of probes) {
      let supported = false;
      try {
        supported = property.startsWith('selector(')
          ? CSS.supports(property)
          : CSS.supports(property, value);
      } catch (error) {
        supported = false;
      }
      results[property] = supported;
      if (supported) {
        supportedCount += 1;
      }
    }

    return {
      total: probes.length,
      supportedCount,
      results
    };
  }

  function getFontRenderingInfo() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const text = 'mmmm WWWW 0123 VM \u{1F4BB}';
    const fonts = isFirefoxUA()
      ? ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy']
      : ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Segoe UI Emoji', 'Noto Sans', 'monospace'];
    const widths = fonts.map((font) => {
      ctx.font = `32px ${formatFontFamily(font)}`;
      return {
        font,
        width: ctx.measureText(text).width
      };
    });
    const rounded = widths.map((item) => Math.round(item.width * 10) / 10);
    return {
      text,
      widths,
      uniqueRoundedWidths: new Set(rounded).size,
      spread: Math.max(...rounded) - Math.min(...rounded)
    };
  }

  function getMediaQueryInfo() {
    const query = (value) => window.matchMedia ? window.matchMedia(value).matches : null;
    return {
      hoverHover: query('(hover: hover)'),
      pointerFine: query('(pointer: fine)'),
      anyPointerCoarse: query('(any-pointer: coarse)'),
      colorGamutP3: query('(color-gamut: p3)'),
      forcedColors: query('(forced-colors: active)'),
      prefersReducedMotion: query('(prefers-reduced-motion: reduce)')
    };
  }

  async function gatherWebRtcIps() {
    const PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!PeerConnection) {
      return { supported: false, ips: [], hostnames: [], reason: 'RTCPeerConnection unavailable' };
    }

    const ips = new Set();
    const hostnames = new Set();
    const candidates = [];
    let pc = null;

    try {
      pc = new PeerConnection({ iceServers: [] });
      pc.createDataChannel('probe');
      pc.onicecandidate = (event) => {
        if (!event.candidate || !event.candidate.candidate) {
          return;
        }
        const candidate = event.candidate.candidate;
        candidates.push(candidate);
        for (const ip of candidate.match(/(?:\d{1,3}\.){3}\d{1,3}/g) || []) {
          ips.add(ip);
        }
        for (const host of candidate.match(/[a-z0-9-]+\.local/gi) || []) {
          hostnames.add(host);
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await delay(1600);
      return {
        supported: true,
        ips: Array.from(ips),
        hostnames: Array.from(hostnames),
        candidates: candidates.length,
        mdnsOnly: ips.size === 0 && hostnames.size > 0
      };
    } catch (error) {
      return { supported: false, ips: [], hostnames: [], error: error.message };
    } finally {
      if (pc) {
        pc.close();
      }
    }
  }

  function measureWebSocketLatency() {
    if (typeof WebSocket !== 'function') {
      return Promise.resolve({ available: false, error: 'WebSocket unavailable', samples: [] });
    }
    if (isStaticPagesMode()) {
      return Promise.resolve({
        available: false,
        skipped: true,
        error: 'GitHub Pages static hosting has no /ws backend endpoint.',
        samples: []
      });
    }

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}/ws`;

    return new Promise((resolve) => {
      const samples = [];
      const starts = new Map();
      let socket = null;
      let done = false;
      let nextId = 0;

      const finish = (payload) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        if (socket && socket.readyState <= 1) {
          socket.close();
        }
        resolve(Object.assign({
          available: samples.length > 0,
          url,
          samples,
          mean: samples.length ? mean(samples) : 0,
          stdDev: samples.length ? stdDev(samples) : 0
        }, payload || {}));
      };

      const sendNext = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          finish({ error: 'Socket not open' });
          return;
        }
        if (samples.length >= 6) {
          finish();
          return;
        }
        const id = nextId;
        nextId += 1;
        starts.set(id, performance.now());
        socket.send(JSON.stringify({ id, clientTs: Date.now() }));
      };

      const timer = setTimeout(() => finish({ error: 'WebSocket timeout' }), 3500);
      try {
        socket = new WebSocket(url);
        socket.onopen = sendNext;
        socket.onerror = () => finish({ error: 'WebSocket error' });
        socket.onmessage = (event) => {
          let id = null;
          try {
            const outer = JSON.parse(event.data);
            const inner = JSON.parse(outer.payload);
            id = inner.id;
          } catch (error) {
            id = nextId - 1;
          }
          const started = starts.get(id);
          if (started !== undefined) {
            samples.push(performance.now() - started);
          }
          setTimeout(sendNext, 20);
        };
      } catch (error) {
        finish({ error: error.message });
      }
    });
  }

  async function measureFetchLatency() {
    const samples = [];
    if (isStaticPagesMode()) {
      return {
        available: false,
        skipped: true,
        samples,
        error: 'GitHub Pages static hosting has no /ping backend endpoint.'
      };
    }
    try {
      for (let i = 0; i < 8; i += 1) {
        const started = performance.now();
        const response = await fetch(apiPath(`/ping?i=${i}&t=${Date.now()}`), { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        await response.json();
        samples.push(performance.now() - started);
      }
      return Object.assign({ available: true, samples }, summarizeSamples(samples));
    } catch (error) {
      return { available: false, samples, error: error.message };
    }
  }

  function classifyVmKeyword(value) {
    const text = normalizeText(value || '');
    for (const keyword of VM_KEYWORDS) {
      if (text.includes(keyword)) {
        if (['vmware', 'virtualbox', 'vbox', 'qemu', 'virgl'].includes(keyword)) {
          return { keyword, severity: 'critical' };
        }
        if (['llvmpipe', 'softpipe', 'swiftshader', 'microsoft basic render'].includes(keyword)) {
          return { keyword, severity: 'strong' };
        }
        return { keyword, severity: 'moderate' };
      }
    }
    return null;
  }

  function classifyVmIp(ip) {
    if (/^10\.0\.2\./.test(ip)) {
      return { name: 'VirtualBox NAT 10.0.2.0/24', severity: 'strong' };
    }
    if (/^192\.168\.56\./.test(ip)) {
      return { name: 'VirtualBox host-only 192.168.56.0/24', severity: 'strong' };
    }
    if (/^192\.168\.122\./.test(ip)) {
      return { name: 'libvirt default 192.168.122.0/24', severity: 'strong' };
    }
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
      return { name: 'RFC1918 172.16.0.0/12 range often used by virtual networks', severity: 'moderate' };
    }
    return null;
  }

  function isModernBrowser() {
    const ua = navigator.userAgent;
    const chrome = Number((ua.match(/(?:Chrome|Chromium)\/(\d+)/) || [])[1] || 0);
    const edge = Number((ua.match(/Edg\/(\d+)/) || [])[1] || 0);
    const firefox = Number((ua.match(/Firefox\/(\d+)/) || [])[1] || 0);
    const safari = Number((ua.match(/Version\/(\d+).+Safari/) || [])[1] || 0);
    return chrome >= 100 || edge >= 100 || firefox >= 100 || safari >= 16;
  }

  function isModernChromium() {
    const ua = navigator.userAgent;
    const chrome = Number((ua.match(/(?:Chrome|Chromium)\/(\d+)/) || [])[1] || 0);
    const edge = Number((ua.match(/Edg\/(\d+)/) || [])[1] || 0);
    return chrome >= 113 || edge >= 113;
  }

  function getCssScreenSize() {
    const dpr = window.devicePixelRatio || 1;
    return {
      width: screen.width / dpr,
      height: screen.height / dpr
    };
  }

  function isNearlyMaximized(metrics, cssScreen) {
    const width = cssScreen && cssScreen.width ? cssScreen.width : screen.width;
    const height = cssScreen && cssScreen.height ? cssScreen.height : screen.height;
    const outerWidth = metrics.outerWidth || window.outerWidth || 0;
    const outerHeight = metrics.outerHeight || window.outerHeight || 0;
    const innerWidth = metrics.innerWidth || window.innerWidth || 0;
    const innerHeight = metrics.innerHeight || window.innerHeight || 0;

    return (outerWidth >= width * 0.9 && outerHeight >= height * 0.72)
      || (innerWidth >= width * 0.9 && innerHeight >= height * 0.62);
  }

  function isPrivacyHardenedTimer(timerInfo) {
    return isFirefoxUA()
      || (timerInfo.minPositiveDelta >= 1 && timerInfo.sameValueRatio > 0.9);
  }

  function isFirefoxUA() {
    return /Firefox\//i.test(navigator.userAgent);
  }

  function isPotentiallySecureOrigin() {
    return window.isSecureContext || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  }

  function isMobileUA() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  }

  function isDesktopUA() {
    return !isMobileUA();
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase();
  }

  function formatFontFamily(font) {
    if (['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'].includes(font)) {
      return font;
    }
    return `"${font}", sans-serif`;
  }

  function hashString(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function parseCssTime(value) {
    const first = String(value || '').split(',')[0].trim();
    if (first.endsWith('ms')) {
      return Number(first.slice(0, -2));
    }
    if (first.endsWith('s')) {
      return Number(first.slice(0, -1)) * 1000;
    }
    return 0;
  }

  function valueAt(source, path) {
    return path.split('.').reduce((value, key) => {
      if (value && Object.prototype.hasOwnProperty.call(value, key)) {
        return value[key];
      }
      return null;
    }, source);
  }

  function countVisibleFields(value) {
    if (value === null || value === undefined) {
      return 0;
    }
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + countVisibleFields(item), 0);
    }
    if (typeof value === 'object') {
      return Object.values(value).reduce((sum, item) => sum + countVisibleFields(item), 0);
    }
    return 1;
  }

  function humanizeKey(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function stringifySnapshotValue(value) {
    if (value === null || value === undefined || value === '') {
      return 'unavailable';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        return value.map((item) => stringifySnapshotValue(item)).join(', ');
      }
      return JSON.stringify(value);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function rawValueClass(value) {
    if (value === null || value === undefined) {
      return 'is-null';
    }
    if (typeof value === 'boolean') {
      return 'is-bool';
    }
    if (typeof value === 'number') {
      return 'is-num';
    }
    if (typeof value === 'object') {
      return 'is-obj';
    }
    return '';
  }

  function stringifyRawValue(value) {
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  function flattenRawRows(value, prefix = '') {
    const rows = [];
    if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
      rows.push([prefix || '(value)', value]);
      return rows;
    }
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const shouldFlattenObject = child
        && typeof child === 'object'
        && !Array.isArray(child)
        && Object.keys(child).length < 18
        && Object.values(child).every((item) => item === null || typeof item !== 'object' || Array.isArray(item));
      if (shouldFlattenObject) {
        rows.push(...flattenRawRows(child, path));
      } else {
        rows.push([path, child]);
      }
    }
    return rows;
  }

  function summarizeSamples(samples) {
    return {
      count: samples.length,
      min: Math.min(...samples),
      max: Math.max(...samples),
      mean: mean(samples),
      stdDev: stdDev(samples)
    };
  }

  function mean(values) {
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function stdDev(values) {
    if (values.length <= 1) {
      return 0;
    }
    const avg = mean(values);
    const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      delay(ms).then(() => fallback)
    ]);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) {
      return 'unknown';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }
}());
