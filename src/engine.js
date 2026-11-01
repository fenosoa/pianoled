'use strict';

const { SOURCES } = require('./constants');
const { NoteStateStore } = require('./state/note-state');
const { createNoteMapper } = require('./mapping/note-map');
const { createPalette, renderFrame, cellsToString } = require('./render/renderer');
const { FrameScheduler } = require('./ddp/frame-scheduler');
const { UdpTransport } = require('./ddp/transport');
const { monotonicMs } = require('./metrics');
const { describe } = require('./midi/messages');
const { silentLogger } = require('./logger');

/**
 * Glue between normalized MIDI events and DDP frames. Hardware-agnostic: the same engine is used
 * by the Windows simulator and the Raspberry Pi service.
 */
class LedEngine {
  constructor(config, { transport, logger = silentLogger, now = monotonicMs } = {}) {
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.store = new NoteStateStore({ sustainMode: config.sustainMode });
    this.mapper = createNoteMapper(config.mapping);
    this.palette = createPalette(config);
    this.transport =
      transport || new UdpTransport({ host: config.ddp.host, port: config.ddp.port, dryRun: config.ddp.dryRun, logger });
    this.override = null; // karaoke mode: frame imposed from outside, MIDI no longer reaches the LEDs
    this.pauseGain = 1; // brightness multiplier of the MIDI-driven frame (karaoke config)
    this.background = null; // ambient animation shown under black LEDs (idle / karaoke ripples)
    this.noteListeners = [];
    this.frame = this.render();
    this.scheduler = new FrameScheduler({
      transport: this.transport,
      getFrame: () => this.frame.pixels,
      isActive: () => !!this.background || this.frame.cells.some(Boolean),
      fps: config.ddp.fps,
      coalesceMs: config.ddp.coalesceMs,
      minFrameGapMs: config.ddp.minFrameGapMs,
      keepalive: config.ddp.keepalive,
      idleKeepaliveMs: config.ddp.idleKeepaliveMs,
      now,
    });
    this.stats = {
      events: 0,
      bySource: Object.fromEntries(SOURCES.map((s) => [s, 0])),
      unmapped: 0,
      ignored: 0,
      frameChanges: 0,
      panics: 0,
    };
  }

  start() {
    this.scheduler.start();
  }

  handle(event) {
    this.stats.events++;
    this.stats.bySource[event.source]++;
    if (event.type === 'other') {
      this.stats.ignored++;
      return false;
    }
    if ((event.type === 'noteon' || event.type === 'noteoff') && this.mapper.ledForNote(event.note) === null) {
      // Still tracked in state (harmless), but never lit. Routing to Synthesia is unaffected.
      this.stats.unmapped++;
      this.logger.debug(`[map] ${event.source} note ${event.note} has no LED`);
    }
    this.store.apply(event);
    if (event.type === 'noteon') for (const listener of this.noteListeners) listener(event);
    return this.refresh();
  }

  /** Clears one source (or both when omitted) and pushes the resulting frame. */
  panic(source) {
    this.stats.panics++;
    if (source) this.store.clearSource(source);
    else this.store.clearAll();
    this.logger.info(`[panic] cleared ${source || 'all sources'}`);
    return this.refresh();
  }

  render() {
    let frame = this.override;
    if (!frame) {
      frame = renderFrame(this.store, this.mapper, this.palette);
      if (this.pauseGain !== 1) for (let i = 0; i < frame.pixels.length; i++) frame.pixels[i] = Math.round(frame.pixels[i] * this.pauseGain);
    }
    return this.background ? this.underlay(frame) : frame;
  }

  /** Copy of `frame` where every black LED shows the background pixel instead (the imposed / MIDI frame is never mutated). */
  underlay(frame) {
    const bg = this.background();
    const pixels = Buffer.from(frame.pixels);
    for (let i = 0; i < pixels.length; i += 3) {
      if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) {
        pixels[i] = bg[i];
        pixels[i + 1] = bg[i + 1];
        pixels[i + 2] = bg[i + 2];
      }
    }
    return { pixels, cells: frame.cells };
  }

  /** Ambient layer: `fn()` returns a FRAME_BYTES buffer shown behind everything else (null removes it). The caller refreshes it. */
  setBackground(fn) {
    this.background = fn;
    return this.refresh();
  }

  /** Registers a callback receiving every accepted note event (after the state is updated). */
  onNote(listener) {
    this.noteListeners.push(listener);
  }

  /** Imposes a { pixels, cells } frame (null restores the MIDI-driven rendering). Notes keep being tracked meanwhile. */
  setOverride(frame) {
    this.override = frame;
    return this.refresh();
  }

  setPauseGain(gain) {
    this.pauseGain = gain;
    return this.refresh();
  }

  refresh() {
    const next = this.render();
    if (next.pixels.equals(this.frame.pixels)) {
      this.frame = next;
      return false;
    }
    this.frame = next;
    this.stats.frameChanges++;
    this.scheduler.markDirty();
    return true;
  }

  ledString() {
    return cellsToString(this.frame.cells);
  }

  cell(index) {
    return this.frame.cells[index];
  }

  snapshot() {
    return {
      leds: this.ledString(),
      notes: this.store.counts(),
      stats: { ...this.stats, bySource: { ...this.stats.bySource } },
      ddp: {
        target: `${this.config.ddp.host}:${this.config.ddp.port}`,
        dryRun: !!this.transport.dryRun,
        transport: { ...this.transport.stats },
        scheduler: this.scheduler.metrics(),
      },
    };
  }

  describeEvent(event) {
    return describe(event);
  }

  async stop() {
    this.store.clearAll();
    this.frame = renderFrame(this.store, this.mapper, this.palette);
    await this.scheduler.stop({ blackFrames: this.config.ddp.blackFramesOnStop });
  }
}

module.exports = { LedEngine };
