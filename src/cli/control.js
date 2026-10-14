#!/usr/bin/env node
'use strict';

// Web control panel: edits .env and supervises the LED service (start / stop / restart / apply).
const { parseArgs } = require('./common');
const { createControlServer } = require('../control/server');

const args = parseArgs();
const host = String(args.host || process.env.CONTROL_HOST || '0.0.0.0');
const port = Number(args.port || process.env.CONTROL_PORT || 8787);
const { server, runner } = createControlServer({ baseDir: process.cwd() });

server.listen(port, host, () => {
  const local = host === '0.0.0.0' || host === '::' ? Object.values(require('node:os').networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address) : [host];
  console.log('Panneau de contrôle :');
  for (const a of local.length ? local : [host]) console.log(`  http://${a}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost') console.log('Attention : aucune authentification, exposez-le uniquement sur un réseau de confiance (--host 127.0.0.1 pour le limiter à cette machine).');
  if (!args['no-autostart']) runner.start();
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await runner.stop();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
