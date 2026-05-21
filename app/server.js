'use strict';

const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 9331);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_PATH = process.env.LOG_PATH || path.join(process.cwd(), 'scans.log');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.disable('x-powered-by');
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: `${MAX_REPORT_BYTES}b`, strict: true }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '1h',
  extensions: ['html']
}));

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isValidReport(body) {
  return body
    && typeof body === 'object'
    && !Array.isArray(body)
    && typeof body.score === 'number'
    && Number.isFinite(body.score)
    && typeof body.verdict === 'string'
    && Array.isArray(body.checks)
    && typeof body.startedAt === 'string'
    && typeof body.finishedAt === 'string';
}

app.get('/ping', (_req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

app.get('/inspect', (req, res) => {
  res.json({
    ts: Date.now(),
    remoteAddress: getClientIp(req),
    method: req.method,
    httpVersion: req.httpVersion,
    protocol: req.protocol,
    secure: req.secure,
    host: req.headers.host || null,
    url: req.originalUrl,
    headers: req.headers
  });
});

app.post('/report', async (req, res, next) => {
  try {
    const serialized = JSON.stringify(req.body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REPORT_BYTES) {
      return res.status(413).json({ ok: false, error: 'Report is too large.' });
    }

    if (!isValidReport(req.body)) {
      return res.status(400).json({ ok: false, error: 'Invalid report shape.' });
    }

    const entry = {
      receivedAt: new Date().toISOString(),
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      score: req.body.score,
      verdict: req.body.verdict,
      report: req.body
    };

    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    return res.status(201).json({ ok: true, logged: true });
  } catch (error) {
    return next(error);
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error && error.type === 'entity.too.large' ? 413 : 500;
  const message = status === 413 ? 'Payload too large.' : 'Internal server error.';
  res.status(status).json({ ok: false, error: message });
});

wss.on('connection', (socket, req) => {
  socket.on('message', (data) => {
    const payload = data.toString('utf8');
    socket.send(JSON.stringify({
      pong: true,
      ts: Date.now(),
      ip: getClientIp(req),
      payload
    }));
  });
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(() => {
    wss.close(() => {
      process.exit(0);
    });
  });

  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  console.log(`Virtual Machine Detector listening on http://${HOST}:${PORT}`);
});
