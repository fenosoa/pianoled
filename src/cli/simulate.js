#!/usr/bin/env node
'use strict';

// Step 2 simulator: drives the LED engine with simulated MIDI events (no keyboard, no Synthesia).
const readline = require('node:readline');
const { LedEngine } = require('../engine');
const { scenarios, createContext } = require('../simulation/scenarios');
const { noteOn, noteOff, controlChange } = require('../midi/messages');
const { parseArgs, loadCliConfig, printBanner, printMetrics } = require('./common');

const HELP = `Usage: node src/cli/simulate.js <scenario|interactive> [--dry-run] [--host IP] [--hold MS] [--fps N]
Scenarios: ${Object.keys(scenarios).join(', ')}
Interactive commands:
  k <note> [vel]        keyboard note on      ku <note>         keyboard note off
  s <note> [ch] [vel]   synthesia note on     su <note> [ch]    synthesia note off (ch = 1..16)
  ped <0|1> [k|s]       sustain pedal         led               print LED line
  panic [k|s]           clear one/all sources stats             print metrics
  run <scenario>        run a scenario        q                 quit (sends black frames)`;

async function main() {
  const args = parseArgs();
  const name = args._[0] || 'interactive';
  if (args.help || (name !== 'interactive' && !scenarios[name])) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  const { config, logger } = loadCliConfig(args);
  const engine = new LedEngine(config, { logger });
  printBanner(engine);
  engine.start();

  let stopping = false;
  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    printMetrics(engine);
    await engine.stop();
    console.log('Black frames sent and socket closed (delivery not guaranteed over UDP).');
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(130));

  const ctx = createContext(engine, { holdMs: Number(args.hold) || 400 });

  if (name !== 'interactive') {
    console.log(`\n== ${name}`);
    await scenarios[name](ctx);
    await ctx.wait(100);
    const r = ctx.results;
    console.log(`\nChecks: ${r.pass} passed, ${r.fail} failed`);
    r.failures.forEach((f) => console.log(`  FAIL ${f}`));
    await shutdown(r.fail ? 1 : 0);
    return;
  }

  console.log(HELP);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  const src = (x) => (x === 's' ? 'synthesia' : x === 'k' ? 'keyboard' : null);
  rl.prompt();
  rl.on('line', async (line) => {
    const [cmd, a, b, c] = line.trim().split(/\s+/);
    const n = Number(a);
    try {
      switch (cmd) {
        case 'k': engine.handle(noteOn('keyboard', n, Number(b) || 100)); break;
        case 'ku': engine.handle(noteOff('keyboard', n)); break;
        case 's': engine.handle(noteOn('synthesia', n, Number(c) || 100, (Number(b) || 1) - 1)); break;
        case 'su': engine.handle(noteOff('synthesia', n, 0, (Number(b) || 1) - 1)); break;
        case 'ped': engine.handle(controlChange(src(b) || 'keyboard', 64, n ? 127 : 0)); break;
        case 'panic': engine.panic(src(a) || undefined); break;
        case 'stats': printMetrics(engine); break;
        case 'led': break;
        case 'run':
          if (!scenarios[a]) throw new Error(`unknown scenario ${a}`);
          await scenarios[a](ctx);
          break;
        case 'q': case 'quit': case 'exit':
          rl.close();
          return;
        case undefined: case '': break;
        default: console.log(HELP);
      }
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
    console.log(`  ${engine.ledString()}`);
    rl.prompt();
  });
  rl.on('close', () => shutdown(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
