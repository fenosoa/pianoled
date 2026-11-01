#!/usr/bin/env node
'use strict';

// Fake chord player: local WebSocket server that replays song -> Em -> C -> G -> D -> idle to every client.
// Usage: node tools/karaoke/fake_player.js [--port 5180] [--step 3] [--loop]
const { WebSocketServer } = require('ws');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const port = Number(opt('port', 5180));
const stepMs = Number(opt('step', 3)) * 1000;
const loop = args.includes('--loop');

const sequence = [
  { type: 'song', name: 'fake', title: 'Fake song' },
  { type: 'chord', chord: 'Em' },
  { type: 'chord', chord: 'C' },
  { type: 'chord', chord: 'G' },
  { type: 'chord', chord: 'D/F#' },
  { type: 'chord', chord: 'D' },
  { type: 'state', playing: true, time: 12 }, // foreign message: must be ignored by the Pi
  { type: 'idle' },
];

const wss = new WebSocketServer({ port, path: '/sync' });
const clients = new Set();
const broadcast = (msg) => {
  const data = JSON.stringify(msg);
  console.log(`-> ${data} (${clients.size} client(s))`);
  clients.forEach((c) => c.readyState === 1 && c.send(data));
};

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('client connected');
  ws.on('message', (raw) => console.log(`<- ${raw}`));
  ws.on('close', () => clients.delete(ws));
});

let i = 0;
setInterval(() => {
  if (!clients.size) return;
  broadcast(sequence[i]);
  i = (i + 1) % sequence.length;
  if (i === 0 && !loop) {
    console.log('sequence done (use --loop to repeat)');
    setTimeout(() => process.exit(0), 500);
  }
}, stepMs);

console.log(`fake player on ws://0.0.0.0:${port}/sync, one message every ${stepMs / 1000}s, waiting for a client...`);
