'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { EnvStore } = require('./env-store');
const { Runner } = require('./runner');
const { GROUPS, FIELDS, NOTE_MAP_FILE } = require('./schema');
const { NoteMapStore } = require('./note-map-store');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function listMidiPorts() {
  try {
    const { listPorts } = require('../adapters/midi-backend');
    return { ...listPorts(), error: null };
  } catch (err) {
    return { inputs: [], outputs: [], error: err.message };
  }
}

function createControlServer({ baseDir = process.cwd(), runner, store, staticDir = path.join(baseDir, 'ui', 'dist') } = {}) {
  store = store || new EnvStore({ baseDir });
  const noteMap = new NoteMapStore({ baseDir, file: NOTE_MAP_FILE });
  runner = runner || new Runner({ baseDir });
  const clients = new Set();

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  runner.on('log', (e) => broadcast('log', e));
  runner.on('status', (s) => broadcast('status', s));

  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 1e6) reject(new Error('payload too large'));
        else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new Error('invalid JSON'));
        }
      });
      req.on('error', reject);
    });

  // Merge the submitted values over the current file, validate, optionally persist.
  const prepare = (values) => {
    const merged = { ...store.effective(), ...values };
    for (const f of FIELDS) merged[f.key] = String(merged[f.key] ?? '').trim();
    merged.NOTE_MAP_FILE = NOTE_MAP_FILE; // fixed path
    return { merged, check: store.validate(merged) };
  };

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return send(res, 415, { error: 'JSON required' }); // also blocks cross-site form posts
    }

    switch (route) {
      case 'GET /api/schema':
        return send(res, 200, { groups: GROUPS, fields: FIELDS });
      case 'GET /api/env':
        return send(res, 200, { values: store.effective(), file: path.basename(store.file), exists: fs.existsSync(store.file) });
      case 'GET /api/note-map':
        return send(res, 200, noteMap.read());
      case 'PUT /api/note-map': {
        const { map, apply = false } = await readJson(req);
        const check = noteMap.validate(map);
        if (!check.ok) return send(res, 422, check);
        noteMap.write(map);
        let restarted = false;
        if (apply && runner.child) {
          await runner.restart();
          restarted = true;
        }
        return send(res, 200, { ...check, saved: true, restarted });
      }
      case 'GET /api/status':
        return send(res, 200, runner.status());
      case 'GET /api/logs':
        return send(res, 200, runner.logs);
      case 'GET /api/ports':
        return send(res, 200, listMidiPorts());
      case 'POST /api/validate': {
        const { values = {} } = await readJson(req);
        return send(res, 200, prepare(values).check);
      }
      case 'PUT /api/env':
      case 'POST /api/apply': {
        const { values = {} } = await readJson(req);
        const { merged, check } = prepare(values);
        if (!check.ok) return send(res, 422, check);
        store.write(merged);
        if (route === 'PUT /api/env') return send(res, 200, { ...check, saved: true });
        const t0 = Date.now();
        if (runner.child) await runner.restart();
        else runner.start();
        return send(res, 200, { ...check, saved: true, restarted: true, ms: Date.now() - t0 });
      }
      case 'POST /api/start':
        return send(res, 200, { started: runner.start() });
      case 'POST /api/stop':
        await runner.stop();
        return send(res, 200, runner.status());
      case 'POST /api/restart':
        await runner.restart();
        return send(res, 200, runner.status());
      case 'POST /api/panic': {
        const { source } = await readJson(req);
        return send(res, 200, { sent: runner.panic(source) });
      }
      default:
        return send(res, 404, { error: 'not found' });
    }
  }

  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: status\ndata: ${JSON.stringify(runner.status())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  function serveStatic(req, res, url) {
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(staticDir, rel);
    if (!file.startsWith(path.resolve(staticDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(staticDir, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('UI non compilée. Lancez : npm run ui:build (ou npm run ui:dev pour le mode développement).');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/events') return events(req, res);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: err.message });
      else res.end();
    }
  });

  return { server, runner, store };
}

module.exports = { createControlServer };
