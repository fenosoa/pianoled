#!/usr/bin/env node
'use strict';

// Records what Synthesia really sends, to decide the green/blue rule from observed data.
const fs = require('node:fs');
const path = require('node:path');
const { loadMidi, listPorts, findPort } = require('../adapters/midi-backend');
const { parseMessage, describe, noteName } = require('../midi/messages');
const { monotonicMs } = require('../metrics');
const { parseArgs, loadCliConfig } = require('./common');

const args = parseArgs();
const { config } = loadCliConfig(args);
const match = args.port || config.midi.synthesiaIn;
const seconds = Number(args.seconds) || 30;
if (!match) {
  console.error('Set SYNTHESIA_IN_PORT or pass --port "<name substring>"');
  process.exit(2);
}

const midi = loadMidi();
const { inputs } = listPorts(midi);
const index = findPort(inputs, match);
if (index < 0) {
  console.error(`Port "${match}" not found. Inputs: ${inputs.join(' | ') || '(none)'}`);
  process.exit(1);
}

const input = new midi.Input();
input.ignoreTypes(false, true, true);
const t0 = monotonicMs();
const log = [];
const perChannel = new Map();
input.on('message', (_d, bytes) => {
  const t = monotonicMs() - t0;
  const ev = parseMessage(bytes, 'synthesia', t);
  log.push({ t: Number(t.toFixed(3)), bytes: Array.from(bytes) });
  if (!ev) return;
  if (!args.quiet) console.log(`${t.toFixed(1).padStart(9)}ms ${describe(ev)}`);
  const s = perChannel.get(ev.channel) || { noteon: 0, noteoff: 0, cc: {}, other: 0, min: 127, max: 0, sum: 0 };
  if (ev.type === 'noteon') {
    s.noteon++;
    s.min = Math.min(s.min, ev.note);
    s.max = Math.max(s.max, ev.note);
    s.sum += ev.note;
  } else if (ev.type === 'noteoff') s.noteoff++;
  else if (ev.type === 'cc') s.cc[ev.controller] = (s.cc[ev.controller] || 0) + 1;
  else s.other++;
  perChannel.set(ev.channel, s);
});
input.openPort(index);
console.log(`Capturing "${inputs[index]}" for ${seconds}s. Play a song in Synthesia (ideally one with both hands, then one hand at a time)...`);

setTimeout(() => {
  input.closePort();
  console.log('\nSummary per channel (channels shown 1..16):');
  for (const [ch, s] of [...perChannel.entries()].sort((a, b) => a[0] - b[0])) {
    const range = s.noteon ? `${s.min}(${noteName(s.min)})..${s.max}(${noteName(s.max)}) mean=${(s.sum / s.noteon).toFixed(1)}` : '-';
    console.log(`  ch${ch + 1}: noteon=${s.noteon} noteoff=${s.noteoff} notes=${range} cc=${JSON.stringify(s.cc)} other=${s.other}`);
  }
  if (perChannel.size === 0) console.log('  nothing received: check the rtpMIDI session and Synthesia MIDI OUT setting.');
  console.log('\nInterpretation: if left/right hands appear on distinct channels, set SYNTH_CHANNEL_COLORS accordingly.');
  console.log('If everything arrives on one channel, channels cannot separate hands; keep a single color or adjust Synthesia output settings.');
  const dir = path.resolve('captures');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `synthesia-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ port: inputs[index], seconds, messages: log }, null, 1));
  console.log(`Raw capture saved to ${file}`);
  process.exit(0);
}, seconds * 1000);
