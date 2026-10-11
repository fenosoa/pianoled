'use strict';

const { loadConfigFromProject, ConfigError } = require('../config');
const { createLogger } = require('../logger');
const { fmtStats } = require('../metrics');

/** Parses `--key value`, `--flag` and positional arguments. */
function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out[key] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

/** CLI flags override env: --dry-run, --host, --fps, --log. */
function loadCliConfig(args) {
  if (args['dry-run']) process.env.DRY_RUN = '1';
  if (args.host) process.env.WLED_HOST = String(args.host);
  if (args.fps) process.env.FPS = String(args.fps);
  if (args.log) process.env.LOG_LEVEL = String(args.log);
  try {
    const config = loadConfigFromProject();
    return { config, logger: createLogger(config.logLevel) };
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

function printBanner(engine) {
  const c = engine.config;
  console.log(
    `DDP -> ${c.ddp.host}:${c.ddp.port} ${c.ddp.dryRun ? '(DRY-RUN, no packet sent)' : ''}\n` +
      `LEDs=${c.ledCount} fps=${c.ddp.fps} keepalive=${c.ddp.keepalive} coalesce=${c.ddp.coalesceMs}ms minGap=${c.ddp.minFrameGapMs}ms brightness=${c.colors.brightness}\n` +
      `mapping: ${engine.mapper.describe()} | sustain=${c.sustainMode} | synthesia default=${c.synthesia.defaultColor} per-channel=${JSON.stringify(
        Object.fromEntries(Object.entries(c.synthesia.channelColors).map(([k, v]) => [`ch${Number(k) + 1}`, v]))
      )}`
  );
}

function printMetrics(engine) {
  const s = engine.snapshot();
  const m = s.ddp.scheduler;
  console.log('\n--- Metrics (sender side only: NOT optical latency) ---');
  console.log(`events processed : ${s.stats.events} (keyboard=${s.stats.bySource.keyboard} synthesia=${s.stats.bySource.synthesia}) unmapped=${s.stats.unmapped} frameChanges=${s.stats.frameChanges}`);
  console.log(`frames sent      : ${m.frames} in ${m.elapsedS.toFixed(2)}s -> ${m.fps.toFixed(1)} fps (change=${m.counters.change} keepalive=${m.counters.keepalive} stop=${m.counters.stop} coalesced=${m.counters.coalescedChanges})`);
  console.log(`frame interval   : ${fmtStats(m.intervalMs)}`);
  console.log(`change->send wait: ${fmtStats(m.waitMs)}`);
  console.log(`send() callback  : ${fmtStats(m.sendCompletionMs)}`);
  console.log(`transport        : packets=${s.ddp.transport.packets} bytes=${s.ddp.transport.bytes} errors=${s.ddp.transport.errors}${s.ddp.transport.lastError ? ` last=${s.ddp.transport.lastError.code}` : ''}`);
}

module.exports = { parseArgs, loadCliConfig, printBanner, printMetrics };
