#!/usr/bin/env node
'use strict';

/*
 * Keyboard -> Synthesia path test, with the white LED checked in parallel.
 *   --mode inject (default): sends a test scale as if played on the keyboard (no keyboard needed);
 *                            watch Synthesia's on-screen keyboard and the strip.
 *   --mode live:             you play the real keyboard for --seconds; counts are compared at the end.
 */
const { LedEngine } = require('../engine');
const { loadMidi } = require('../adapters/midi-backend');
const { ManagedPort } = require('../adapters/managed-port');
const { MidiRouter } = require('../adapters/router');
const { noteOn, noteOff, toBytes, noteName } = require('../midi/messages');
const { monotonicMs } = require('../metrics');
const { parseArgs, loadCliConfig, printBanner, printMetrics } = require('./common');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs();
  const { config, logger } = loadCliConfig(args);
  const mode = args.mode || 'inject';
  const midi = loadMidi();
  const engine = new LedEngine(config, { logger });
  printBanner(engine);
  const out = new ManagedPort({ midi, direction: 'output', match: config.midi.synthesiaOut, label: 'synthesia-out', pollMs: config.midi.pollMs, logger });
  out.start();
  engine.start();
  if (!out.connected) console.warn(`WARNING: SYNTHESIA_OUT_PORT "${config.midi.synthesiaOut}" not connected; LEDs only.`);

  let ok = 0;
  let bad = 0;
  if (mode === 'inject') {
    const notes = [60, 62, 64, 65, 67, 69, 71, 72];
    console.log(`Injecting ${notes.map(noteName).join(' ')} as keyboard notes (ch1). Synthesia should highlight each key.`);
    for (const n of notes) {
      const on = noteOn('keyboard', n, 90, 0, monotonicMs());
      const sent = out.send(toBytes(on));
      engine.handle(on);
      const led = engine.mapper.ledForNote(n);
      const white = led !== null && engine.cell(led)?.symbol === 'W';
      white && sent ? ok++ : bad++;
      console.log(`  ${noteName(n).padEnd(4)} forwarded=${sent} led=${led ?? 'unmapped'} white=${white}  ${engine.ledString()}`);
      await wait(Number(args.hold) || 400);
      const off = noteOff('keyboard', n, 0, 0, monotonicMs());
      out.send(toBytes(off));
      engine.handle(off);
      await wait(100);
    }
  } else if (mode === 'live') {
    const seconds = Number(args.seconds) || 20;
    const kin = new ManagedPort({ midi, direction: 'input', match: config.midi.keyboardIn, label: 'keyboard-in', pollMs: config.midi.pollMs, logger });
    const router = new MidiRouter({ engine, keyboardIn: kin, synthesiaOut: out, forwardKeyboard: true, diag: true, logger });
    router.start();
    kin.start();
    let whiteChecks = 0;
    kin.on('message', (bytes) => {
      if ((bytes[0] & 0xf0) === 0x90 && bytes[2] > 0) {
        const led = engine.mapper.ledForNote(bytes[1]);
        if (led !== null && engine.cell(led)?.symbol === 'W') whiteChecks++;
      }
    });
    console.log(`Play the keyboard for ${seconds}s...`);
    await wait(seconds * 1000);
    kin.stop();
    console.log(`keyboard messages=${router.stats.keyboardIn} forwarded=${router.stats.forwarded} dropped=${router.stats.forwardDropped} noteOnLitWhite=${whiteChecks} unmapped=${engine.stats.unmapped}`);
    ok = router.stats.forwardDropped === 0 && router.stats.keyboardIn > 0 ? 1 : 0;
    bad = ok ? 0 : 1;
  } else {
    console.error('--mode must be inject or live');
    process.exit(2);
  }
  out.stop();
  printMetrics(engine);
  await engine.stop();
  console.log(`\nResult: ${bad === 0 ? 'OK' : 'CHECK FAILURES'} (${ok} ok, ${bad} failed). Confirm visually in Synthesia that keys were received.`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
