'use strict';

const { FRAME_BYTES } = require('../constants');
const { encodeDdpPacket, nextSequence } = require('./packet');
const { monotonicMs, SampleStats } = require('../metrics');

/**
 * Decides when frames are sent:
 *  - change: a state change schedules one flush (setImmediate when coalesceMs=0, else a timer),
 *    so events arriving together share a frame; minFrameGapMs caps the burst rate.
 *  - keepalive: the current frame is resent at `fps` (always / only while active / never).
 * All sends go through sendFrame() on one transport, so ordering is preserved.
 */
class FrameScheduler {
  constructor({
    transport,
    getFrame,
    isActive = () => false,
    fps = 40,
    coalesceMs = 0,
    minFrameGapMs = 5,
    keepalive = 'always',
    idleKeepaliveMs = 3000,
    now = monotonicMs,
    spinShortWaits = process.platform === 'win32',
  }) {
    this.spinShortWaits = spinShortWaits;
    this.transport = transport;
    this.getFrame = getFrame;
    this.isActive = isActive;
    this.periodMs = 1000 / fps;
    this.coalesceMs = coalesceMs;
    this.minFrameGapMs = minFrameGapMs;
    this.keepalive = keepalive;
    this.idleKeepaliveMs = idleKeepaliveMs;
    this.now = now;

    this.sequence = 0;
    this.pending = null;
    this.dirtySince = null;
    this.lastSendAt = null;
    this.lastChangeAt = null;
    this.keepaliveTimer = null;
    this.running = false;
    this.startedAt = null;
    this.inFlight = 0;

    this.counters = { change: 0, keepalive: 0, stop: 0, manual: 0, coalescedChanges: 0, sendErrors: 0 };
    this.intervals = new SampleStats();
    this.waits = new SampleStats();
    this.sendCompletion = new SampleStats();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
    if (this.keepalive !== 'off') {
      this.keepaliveTimer = setInterval(() => this.keepaliveTick(), this.periodMs);
    }
    this.sendFrame(this.getFrame(), 'manual');
  }

  markDirty() {
    if (!this.running) return;
    const t = this.now();
    this.lastChangeAt = t;
    if (this.pending) {
      this.counters.coalescedChanges++;
      return;
    }
    this.dirtySince = t;
    const sinceLast = this.lastSendAt === null ? Infinity : t - this.lastSendAt;
    const delay = Math.max(this.coalesceMs, this.minFrameGapMs - sinceLast);
    if (delay <= 0) {
      this.pending = { kind: 'immediate', handle: setImmediate(() => this.flush()) };
    } else if (this.spinShortWaits && delay < 16) {
      // Windows timers round up to ~15 ms; short gaps are waited on the event loop instead (bounded CPU).
      const target = t + delay;
      const spin = () => {
        if (this.now() >= target) this.flush();
        else this.pending.handle = setImmediate(spin);
      };
      this.pending = { kind: 'immediate', handle: setImmediate(spin) };
    } else {
      this.pending = { kind: 'timeout', handle: setTimeout(() => this.flush(), delay) };
    }
  }

  cancelPending() {
    if (!this.pending) return;
    if (this.pending.kind === 'immediate') clearImmediate(this.pending.handle);
    else clearTimeout(this.pending.handle);
    this.pending = null;
  }

  flush() {
    this.pending = null;
    if (!this.running) return;
    if (this.dirtySince !== null) this.waits.add(this.now() - this.dirtySince);
    this.dirtySince = null;
    this.sendFrame(this.getFrame(), 'change');
  }

  keepaliveTick() {
    if (!this.running || this.pending) return;
    const t = this.now();
    // Skip if a change frame just went out; avoids doubling the rate during activity.
    if (this.lastSendAt !== null && t - this.lastSendAt < this.periodMs * 0.5) return;
    if (this.keepalive === 'active') {
      const recent = this.lastChangeAt !== null && t - this.lastChangeAt < this.idleKeepaliveMs;
      if (!recent && !this.isActive()) return;
    }
    this.sendFrame(this.getFrame(), 'keepalive');
  }

  sendFrame(pixels, reason) {
    this.sequence = nextSequence(this.sequence);
    const packet = encodeDdpPacket(pixels, this.sequence);
    const t = this.now();
    if (this.lastSendAt !== null) this.intervals.add(t - this.lastSendAt);
    this.lastSendAt = t;
    this.counters[reason]++;
    this.inFlight++;
    return this.transport.send(packet).then((err) => {
      this.inFlight--;
      this.sendCompletion.add(this.now() - t);
      if (err) this.counters.sendErrors++;
      return err;
    });
  }

  /** Stops timers, sends black frames, closes the transport. Delivery cannot be guaranteed over UDP. */
  async stop({ blackFrames = 3, gapMs = 20 } = {}) {
    if (!this.running) {
      await this.transport.close();
      return;
    }
    this.running = false;
    this.cancelPending();
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    const black = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < blackFrames; i++) {
      await this.sendFrame(black, 'stop');
      if (i < blackFrames - 1) await new Promise((r) => setTimeout(r, gapMs));
    }
    await this.transport.close();
  }

  metrics() {
    const elapsed = this.startedAt === null ? 0 : (this.now() - this.startedAt) / 1000;
    const frames = this.counters.change + this.counters.keepalive + this.counters.manual + this.counters.stop;
    return {
      elapsedS: elapsed,
      frames,
      fps: elapsed > 0 ? frames / elapsed : 0,
      counters: { ...this.counters },
      inFlight: this.inFlight,
      intervalMs: this.intervals.summary(),
      waitMs: this.waits.summary(),
      sendCompletionMs: this.sendCompletion.summary(),
    };
  }

  resetMetrics() {
    for (const k of Object.keys(this.counters)) this.counters[k] = 0;
    this.intervals.reset();
    this.waits.reset();
    this.sendCompletion.reset();
    this.startedAt = this.now();
  }
}

module.exports = { FrameScheduler };
