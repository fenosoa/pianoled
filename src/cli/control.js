#!/usr/bin/env node
'use strict';

// Web control panel: edits .env and supervises the LED service (start / stop / restart / apply).
const { parseArgs } = require('./common');
const { createControlServer } = require('../control/server');

const args = parseArgs();
const host = String(args.host || process.env.CONTROL_HOST || '127.0.0.1');
const port = Number(args.port || process.env.CONTROL_PORT || 8787);
const { server, runner } = createControlServer({ baseDir: process.cwd() });

server.listen(port, host, () => {
  console.log(`Panneau de contrôle : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost') console.log('Attention : aucune authentification, exposez-le uniquement sur un réseau de confiance.');
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
