#!/usr/bin/env node
'use strict';

// Step 3 service: real MIDI ports (keyboard, rtpmidid/rtpMIDI) -> same LED engine as the simulator.
const readline = require('node:readline');
const { LedEngine } = require('../engine');
const { loadMidi } = require('../adapters/midi-backend');
const { ManagedPort } = require('../adapters/managed-port');
const { MidiRouter } = require('../adapters/router');
const { parseArgs, loadCliConfig, printBanner, printMetrics } = require('./common');

async function main() {
  const args = parseArgs();
  const { config, logger } = loadCliConfig(args);
  const diag = !!args.diag;
  const m = config.midi;

  if (m.keyboardIn && m.synthesiaIn && m.keyboardIn.toLowerCase() === m.synthesiaIn.toLowerCase()) {
    console.error('KEYBOARD_IN_PORT and SYNTHESIA_IN_PORT match the same port: refusing to merge both sources.');
    process.exit(2);
  }
  if (!m.keyboardIn && !m.synthesiaIn) {
    console.error('No input configured. Set KEYBOARD_IN_PORT and/or SYNTHESIA_IN_PORT (see `npm run ports`).');
    process.exit(2);
  }

  const midi = loadMidi();
  const engine = new LedEngine(config, { logger });
  printBanner(engine);
  console.log(`MIDI: keyboardIn="${m.keyboardIn}" synthesiaIn="${m.synthesiaIn}" synthesiaOut="${m.synthesiaOut}" forwardKeyboard=${m.forwardKeyboard} forwardSynthesia=${m.forwardSynthesia} keyboardOut="${m.forwardSynthesia ? m.keyboardOut : ''}" echoGuard=${m.echoGuardMs}ms synthStale=${m.synthStaleMs}ms`);

  const mk = (direction, match, label) => (match ? new ManagedPort({ midi, direction, match, label, pollMs: m.pollMs, logger }) : null);
  const keyboardIn = mk('input', m.keyboardIn, 'keyboard-in');
  const synthesiaIn = mk('input', m.synthesiaIn, 'synthesia-in');
  const synthesiaOut = m.forwardKeyboard ? mk('output', m.synthesiaOut, 'synthesia-out') : null;
  if (m.forwardKeyboard && !synthesiaOut) logger.warn('FORWARD_KEYBOARD=1 but SYNTHESIA_OUT_PORT is empty: keyboard notes will not reach Synthesia');

  const keyboardOut = m.forwardSynthesia ? mk('output', m.keyboardOut, 'keyboard-out') : null;
  if (m.forwardSynthesia && !keyboardOut) logger.warn('FORWARD_SYNTHESIA=1 but no KEYBOARD_OUT_PORT/KEYBOARD_IN_PORT: Synthesia notes will not reach the keyboard');

  const router = new MidiRouter({
    engine, keyboardIn, synthesiaIn, synthesiaOut, keyboardOut, forwardSynthesia: m.forwardSynthesia,
    forwardKeyboard: m.forwardKeyboard, echoGuardMs: m.echoGuardMs, synthStaleMs: m.synthStaleMs, diag, logger,
  });

  engine.start();
  router.start();
  [keyboardIn, synthesiaIn, synthesiaOut, keyboardOut].forEach((p) => p && p.start());

  const status = () => {
    const s = engine.snapshot();
    const port = (p) => (p ? (p.connected ? `up("${p.portName}")` : 'down') : 'off');
    console.log(`[status] ${s.leds}`);
    console.log(
      `[status] kbd-in=${port(keyboardIn)} syn-in=${port(synthesiaIn)} syn-out=${port(synthesiaOut)} kbd-out=${port(keyboardOut)} | ` +
        `kbdIn=${router.stats.keyboardIn} fwd=${router.stats.forwarded} fwdDrop=${router.stats.forwardDropped} synIn=${router.stats.synthesiaIn} toKbd=${router.stats.synthToKeyboard} toKbdDrop=${router.stats.synthToKeyboardDropped} echoDrop=${router.stats.echoDropped} | ` +
        `ddp frames=${s.ddp.scheduler.frames} fps=${s.ddp.scheduler.fps.toFixed(1)} errors=${s.ddp.transport.errors}`
    );
  };
  const statusTimer = diag ? setInterval(status, Number(args['status-every']) || 5000) : null;

  let stopping = false;
  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    if (statusTimer) clearInterval(statusTimer);
    router.stop(); // releases notes still sounding on the keyboard before its port closes
    [keyboardIn, synthesiaIn, synthesiaOut, keyboardOut].forEach((p) => p && p.stop());
    printMetrics(engine);
    await engine.stop();
    console.log('Stopped: black frames sent (not guaranteed if WLED is unreachable), socket closed.');
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  if (process.platform !== 'win32') process.on('SIGUSR1', () => engine.panic());
  // Control channel used by the web panel (npm run control): graceful stop works on Windows too.
  if (process.send) {
    process.on('message', (msg) => {
      if (msg && msg.type === 'shutdown') shutdown(0);
      else if (msg && msg.type === 'panic') engine.panic(msg.source);
    });
    process.on('disconnect', () => shutdown(0));
  }

  if (process.stdin.isTTY) {
    console.log('Commands: panic | panic k | panic s | status | stats | q');
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const [cmd, arg] = line.trim().split(/\s+/);
      if (cmd === 'panic') engine.panic(arg === 'k' ? 'keyboard' : arg === 's' ? 'synthesia' : undefined);
      else if (cmd === 'status') status();
      else if (cmd === 'stats') printMetrics(engine);
      else if (cmd === 'q') shutdown(0);
    });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
