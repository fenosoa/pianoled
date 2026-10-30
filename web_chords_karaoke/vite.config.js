import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [react(), stemsPlugin],
  server: { port: 5180, host: true, watch: { ignored: ['**/piano_stems_output/**'] } },
  preview: { port: 5181, host: true },
});
