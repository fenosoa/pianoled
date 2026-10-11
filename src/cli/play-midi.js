#!/usr/bin/env node
'use strict';

/*
 * Plays a .mid file in real time through the LED engine (no RTP-MIDI, no MIDI port).
 * By default every note is a "synthesia" event (green/blue per SYNTH_CHANNEL_COLORS);
 * --keyboard-channels / --keyboard-tracks route some parts as "keyboard" (white) to test priority.
 */
const fs = require('node:fs');
const path = require('node:path');
const { LedEngine } = require('../engine');
const { parseSmf, buildTimeline } = require('../midi/smf');
const { parseMessage, noteName } = require('../midi/messages');
const { monotonicMs, SampleStats, fmtStats } = require('../metrics');
const { parseArgs, loadCliConfig, printBanner, printMetrics } = require('./common');

const HELP = `Usage: node src/cli/play-midi.js <file.mid> [options]
  --info                      analyse the file only, do not play
  --source synthesia|keyboard source for all notes (default synthesia)
  --keyboard-channels 1,2     these channels (1..16) are played as keyboard (white)
  --keyboard-tracks 2         these tracks (1-based, see --info) are played as keyboard
  --speed 1.0                 tempo factor (2 = twice as fast)
  --transpose 0               semitones added to every note (forwarded raw otherwise)
  --start 0 --seconds N       start offset and maximum duration (seconds)
  --include-drums             also light channel 10 (excluded by default)
  --leds                      print the LED line during playback
  --dry-run --host IP --fps N --log debug`;

const parseList = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => Number(s.trim())).filter(Number.isInteger));

function analyse(smf, timeline, engine) {
  const durationS = timeline.length ? timeline[timeline.length - 1].timeMs / 1000 : 0;
  console.log(`SMF format ${smf.format}, ${smf.tracks.length} track(s), division ${smf.division}, duration ${durationS.toFixed(1)}s`);
  const perTrack = new Map();
  const perChannel = new Map();
  for (const e of timeline) {
    if ((e.bytes[0] & 0xf0) !== 0x90 || e.bytes[2] === 0) continue;
    for (const [map, key] of [[perTrack, e.track], [perChannel, e.channel]]) {
      const s = map.get(key) || { notes: 0, min: 127, max: 0, unmapped: 0 };
      s.notes++;
      s.min = Math.min(s.min, e.bytes[1]);
      s.max = Math.max(s.max, e.bytes[1]);
      map.set(key, s);
    }
  }
  const fmt = (s) => `notes=${s.notes} range=${s.min}(${noteName(s.min)})..${s.max}(${noteName(s.max)})`;
  for (const [t, s] of [...perTrack].sort((a, b) => a[0] - b[0])) console.log(`  track ${t + 1} "${smf.tracks[t]?.name || ''}": ${fmt(s)}`);
  for (const [c, s] of [...perChannel].sort((a, b) => a[0] - b[0])) {
    const color = c === 9 ? 'drums' : engine.palette.synthForChannel(c).name;
    console.log(`  ch${c + 1}: ${fmt(s)} -> synthesia color ${color}`);
  }
  console.log(`  LED mapping: ${engine.mapper.describe()}`);
}

async function main() {
  const args = parseArgs();
  const file = args._[0];
  if (!file || args.help) {
    console.log(HELP);
    process.exit(file ? 0 : 1);
  }
  const { config, logger } = loadCliConfig(args);
  const smf = parseSmf(fs.readFileSync(path.resolve(file)));
  const timeline = buildTimeline(smf);
  const engine = new LedEngine(config, { logger });

  const speed = Number(args.speed) || 1;
  const transpose = Number(args.transpose) || 0;
  const startMs = (Number(args.start) || 0) * 1000;
  const maxMs = args.seconds ? Number(args.seconds) * 1000 : Infinity;
  const defaultSource = args.source === 'keyboard' ? 'keyboard' : 'synthesia';
  const kbChannels = new Set(parseList(args['keyboard-channels']).map((c) => c - 1));
  const kbTracks = new Set(parseList(args['keyboard-tracks']).map((t) => t - 1));
  const includeDrums = !!args['include-drums'];

  printBanner(engine);
  analyse(smf, timeline, engine);
  if (args.info) process.exit(0);

  const events = timeline.filter((e) => e.timeMs >= startMs && e.timeMs - startMs <= maxMs && (includeDrums || e.channel !== 9));
  console.log(
    `\nPlaying ${events.length} events, speed x${speed}, transpose ${transpose}, default source ${defaultSource}` +
      `${kbChannels.size ? `, keyboard channels ${[...kbChannels].map((c) => c + 1)}` : ''}` +
      `${kbTracks.size ? `, keyboard tracks ${[...kbTracks].map((t) => t + 1)}` : ''}${includeDrums ? '' : ' (channel 10 drums skipped)'}. Ctrl+C to stop.`
  );

  engine.start();
  const lateness = new SampleStats();
  let skipped = 0;
  let stopping = false;
  let ledTimer = null;

  const finish = async (code) => {
    if (stopping) return;
    stopping = true;
    if (ledTimer) clearInterval(ledTimer);
    engine.panic();
    console.log(`\nscheduling lateness (actual - planned dispatch, Node side): ${fmtStats(lateness.summary())}`);
    if (skipped) console.log(`notes skipped by transpose (outside 0..127): ${skipped}`);
    printMetrics(engine);
    await engine.stop();
    process.exit(code);
  };
  process.on('SIGINT', () => finish(130));
  if (args.leds) ledTimer = setInterval(() => console.log(`  ${engine.ledString()}`), 100);

  const t0 = monotonicMs();
  let i = 0;
  const step = () => {
    if (stopping) return;
    const now = monotonicMs();
    while (i < events.length) {
      const e = events[i];
      const due = t0 + (e.timeMs - startMs) / speed;
      if (due > now) break;
      lateness.add(now - due);
      i++;
      const bytes = e.bytes.slice();
      const kind = bytes[0] & 0xf0;
      if (transpose && (kind === 0x80 || kind === 0x90 || kind === 0xa0)) {
        bytes[1] += transpose;
        if (bytes[1] < 0 || bytes[1] > 127) {
          skipped++;
          continue;
        }
      }
      const source = kbChannels.has(e.channel) || kbTracks.has(e.track) ? 'keyboard' : defaultSource;
      const ev = parseMessage(bytes, source, now);
      if (ev) engine.handle(ev);
    }
    if (i >= events.length) {
      setTimeout(() => finish(0), 300);
      return;
    }
    // Coarse timer, then setImmediate for the last ms (Windows timers are ~15 ms granular).
    const wait = t0 + (events[i].timeMs - startMs) / speed - monotonicMs();
    if (wait > 20) setTimeout(step, wait - 16);
    else setImmediate(step);
  };
  step();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
