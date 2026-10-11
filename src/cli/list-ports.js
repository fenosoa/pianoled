#!/usr/bin/env node
'use strict';

// Lists MIDI ports exactly as the system reports them; copy a distinctive substring into .env.
const { spawnSync } = require('node:child_process');
const { listPorts, findPort } = require('../adapters/midi-backend');
const { parseArgs, loadCliConfig } = require('./common');

function runTool(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) return `(${cmd} not available: ${r.error.code})`;
  return (r.stdout || '') + (r.stderr || '');
}

const { config } = loadCliConfig(parseArgs());
let ports;
try {
  ports = listPorts();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log('MIDI inputs (readable by this app):');
ports.inputs.forEach((n, i) => console.log(`  [${i}] ${n}`));
console.log('MIDI outputs (writable by this app):');
ports.outputs.forEach((n, i) => console.log(`  [${i}] ${n}`));

const show = (label, list, match) =>
  console.log(`  ${label.padEnd(20)} "${match}" -> ${match ? (findPort(list, match) >= 0 ? `"${list[findPort(list, match)]}"` : 'NOT FOUND') : '(not set)'}`);
console.log('\nCurrent .env selection:');
show('KEYBOARD_IN_PORT', ports.inputs, config.midi.keyboardIn);
show('SYNTHESIA_IN_PORT', ports.inputs, config.midi.synthesiaIn);
show('SYNTHESIA_OUT_PORT', ports.outputs, config.midi.synthesiaOut);

if (process.platform === 'linux') {
  console.log('\n$ aconnect -l');
  console.log(runTool('aconnect', ['-l']));
  console.log('$ amidi -l');
  console.log(runTool('amidi', ['-l']));
}
