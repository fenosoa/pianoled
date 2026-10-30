import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { WebSocketServer } from 'ws';

// Dossier des stems (web_chords_karaoke/piano_stems_output) : un sous-répertoire par chanson (bass/drums/guitar/instrumental/other/piano/vocals.flac + <nom>.chords.json)
const STEMS_DIR = process.env.STEMS_DIR || path.resolve(import.meta.dirname, 'piano_stems_output');
const STEMS_PREFIX = '/stems/';
// 'instrumental' = somme des autres pistes sans la voix : jamais lu
const TRACK_ORDER = ['vocals', 'piano', 'guitar', 'bass', 'drums', 'other'];
const MIME = { '.flac': 'audio/flac', '.json': 'application/json' };

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Liste les chansons à chaque appel (on peut en ajouter sans redémarrer)
const listSongs = () => {
  const songs = [];
  for (const entry of fs.readdirSync(STEMS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(STEMS_DIR, entry.name);
    const files = fs.readdirSync(dir);
    const chords = files.find((f) => f.endsWith('.chords.json'));
    const lyrics = files.find((f) => f.endsWith('.lyrics.json'));
    const tracks = files
      .filter((f) => f.endsWith('.flac'))
      .map((f) => path.basename(f, '.flac'))
      .filter((t) => TRACK_ORDER.includes(t))
      .sort((a, b) => TRACK_ORDER.indexOf(a) - TRACK_ORDER.indexOf(b));
    if (!chords || tracks.length === 0) continue;
    const url = (f) => `${STEMS_PREFIX}${encodeURIComponent(entry.name)}/${encodeURIComponent(f)}`;
    const meta = readJson(path.join(dir, `${entry.name}.meta.json`));
    songs.push({
      name: entry.name,
      title: meta?.title || entry.name,
      json: url(chords),
      lyrics: lyrics ? url(lyrics) : null,
      tracks: tracks.map((t) => ({ name: t, url: url(`${t}.flac`) })),
    });
  }
  return songs.sort((a, b) => a.name.localeCompare(b.name));
};

const serveStems = (req, res, next) => {
  if (!req.url.startsWith(STEMS_PREFIX)) return next();
  try {
    const rel = decodeURIComponent(req.url.slice(STEMS_PREFIX.length).split('?')[0]);
    if (rel === 'index.json') {
      res.setHeader('Content-Type', MIME['.json']);
      return res.end(JSON.stringify(listSongs()));
    }
    const file = path.resolve(STEMS_DIR, rel);
    if (!file.startsWith(path.resolve(STEMS_DIR) + path.sep) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    const { size } = fs.statSync(file);
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', size);
      fs.createReadStream(file).pipe(res);
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
};

const stemsPlugin = {
  name: 'serve-stems',
  configureServer(server) {
    server.middlewares.use(serveStems);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveStems);
  },
};

// --- SYNCHRO : le lecteur d'accords (maître) diffuse chanson + position aux suiveurs (web_lyrics_karaoke) ---
// Protocole JSON : le client se déclare { type:'hello', role:'master'|'follower' } ; les messages du maître
// ({type:'song'} paroles + titre, {type:'state'} playing/time/rate) sont relayés aux suiveurs et mémorisés
// pour être rejoués à un suiveur qui arrive en cours de route.
// Commandes (Stream Deck, action « API Request ») : GET ou POST /control/mixer/<0-9> → relayées au maître
// ({type:'command', key}), qui exécute le raccourci de même numéro (voir MIXER_SHORTCUTS dans le lecteur).
const SYNC_PATH = '/sync';
const CONTROL_RE = /^\/control\/mixer\/([0-9])\/?$/;
const syncPlugin = {
  name: 'sync-hub',
  configureServer(server) {
    attachSyncHub(server);
  },
  configurePreviewServer(server) {
    attachSyncHub(server);
  },
};

function attachSyncHub({ httpServer, middlewares }) {
  if (!httpServer) return;
  const wss = new WebSocketServer({ noServer: true });
  const followers = new Set();
  let master = null;
  const last = { song: null, state: null };

  middlewares.use((req, res, next) => {
    const match = CONTROL_RE.exec(req.url.split('?')[0]);
    if (!match || (req.method !== 'GET' && req.method !== 'POST')) return next();
    const ok = master?.readyState === 1;
    if (ok) master.send(JSON.stringify({ type: 'command', key: match[1] }));
    res.statusCode = ok ? 200 : 503; // 503 : aucun lecteur connecté
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok }));
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== SYNC_PATH) return; // laisse le HMR de Vite tranquille
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    let role = null;
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        role = msg.role === 'master' ? 'master' : 'follower';
        if (role === 'master') {
          if (master && master !== ws) master.close();
          master = ws;
        } else {
          followers.add(ws);
          if (last.song) ws.send(last.song);
          if (last.state) ws.send(last.state);
        }
        return;
      }
      if (role !== 'master' || (msg.type !== 'song' && msg.type !== 'state')) return;
      const data = String(raw);
      last[msg.type] = data;
      followers.forEach((f) => f.readyState === 1 && f.send(data));
    });
    ws.on('close', () => {
      followers.delete(ws);
      if (master === ws) {
        master = null;
        const paused = last.state && JSON.stringify({ ...JSON.parse(last.state), playing: false });
        if (paused) {
          last.state = paused;
          followers.forEach((f) => f.readyState === 1 && f.send(paused));
        }
      }
    });
  });
}

export default defineConfig({
  plugins: [react(), stemsPlugin, syncPlugin],
  server: { port: 5180, host: true, watch: { ignored: ['**/piano_stems_output/**'] } },
  preview: { port: 5181, host: true },
});
