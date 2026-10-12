'use strict';

const { parseMessage, describe } = require('../midi/messages');
const { monotonicMs } = require('../metrics');
const { silentLogger } = require('../logger');

/**
 * Two strictly separate logical paths:
 *   1. keyboardIn  -> synthesiaOut (forwarded unchanged) + engine as source "keyboard"
 *   2. synthesiaIn -> engine as source "synthesia", and only when forwardSynthesia is enabled also
 *      -> keyboardOut (so the keyboard's sound engine plays what Synthesia plays).
 * Synthesia output is never re-injected into its input. Keyboard notes are never sent back to the keyboard:
 * with the optional echo guard, a Synthesia message that merely echoes a forwarded keyboard note is dropped
 * before it can reach the LEDs or the keyboard output.
 */
class MidiRouter {
  constructor({ engine, keyboardIn, synthesiaIn, synthesiaOut, keyboardOut = null, forwardSynthesia = false, forwardKeyboard = true, echoGuardMs = 0, synthStaleMs = 0, diag = false, logger = silentLogger, print = console.log }) {
    this.engine = engine;
    this.keyboardIn = keyboardIn;
    this.synthesiaIn = synthesiaIn;
    this.synthesiaOut = synthesiaOut;
    this.keyboardOut = keyboardOut;
    this.forwardSynthesia = forwardSynthesia;
    // Notes/pedals forwarded to the keyboard and not yet released, so they can be closed on disconnect/stop.
    this.heldToKeyboard = new Set();
    this.pedalToKeyboard = new Set();
    this.forwardKeyboard = forwardKeyboard;
    this.echoGuardMs = echoGuardMs;
    this.synthStaleMs = synthStaleMs;
    this.diag = diag;
    this.logger = logger;
    this.print = print;
    this.t0 = monotonicMs();
    this.recentForwards = new Map();
    this.lastSynthMessageAt = null;
    this.staleTimer = null;
    this.stats = { keyboardIn: 0, forwarded: 0, forwardDropped: 0, synthesiaIn: 0, synthToKeyboard: 0, synthToKeyboardDropped: 0, echoDropped: 0, malformed: 0, staleClears: 0 };
  }

  start() {
    if (this.keyboardIn) {
      this.keyboardIn.on('message', (bytes, ts) => this.onKeyboard(bytes, ts));
      this.keyboardIn.on('disconnected', () => this.engine.panic('keyboard'));
    }
    if (this.synthesiaIn) {
      this.synthesiaIn.on('message', (bytes, ts) => this.onSynthesia(bytes, ts));
      this.synthesiaIn.on('disconnected', () => {
        this.engine.panic('synthesia');
        this.releaseKeyboardOut();
      });
    }
    if (this.synthStaleMs > 0) {
      this.staleTimer = setInterval(() => this.checkStale(), Math.min(1000, this.synthStaleMs));
    }
  }

  stop() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;
    this.releaseKeyboardOut();
  }

  /** Sends Note Off / pedal-up for everything Synthesia left sounding on the keyboard. */
  releaseKeyboardOut() {
    if (!this.keyboardOut) return;
    for (const key of this.heldToKeyboard) {
      const [ch, note] = key.split(':').map(Number);
      this.keyboardOut.send([0x80 | ch, note, 0]);
    }
    for (const ch of this.pedalToKeyboard) this.keyboardOut.send([0xb0 | ch, 64, 0]);
    this.heldToKeyboard.clear();
    this.pedalToKeyboard.clear();
  }

  forwardToKeyboard(bytes, event) {
    const sent = this.keyboardOut.send(Array.from(bytes));
    if (sent) this.stats.synthToKeyboard++;
    else this.stats.synthToKeyboardDropped++;
    if (event.type === 'noteon') this.heldToKeyboard.add(`${event.channel}:${event.note}`);
    else if (event.type === 'noteoff') this.heldToKeyboard.delete(`${event.channel}:${event.note}`);
    else if (event.type === 'cc' && event.controller === 64) {
      if (event.value >= 64) this.pedalToKeyboard.add(event.channel);
      else this.pedalToKeyboard.delete(event.channel);
    }
    return sent;
  }

  log(dir, origin, event, extra = '') {
    if (!this.diag) return;
    const t = (event.timestamp - this.t0).toFixed(3).padStart(10);
    this.print(`${t}ms ${dir.padEnd(3)} ${origin.padEnd(13)} ${describe(event)}${extra}`);
  }

  onKeyboard(bytes, ts = monotonicMs()) {
    this.stats.keyboardIn++;
    const isChannelMessage = bytes[0] >= 0x80 && bytes[0] < 0xf0;
    // Forward first: the player's latency to Synthesia matters more than the LED update.
    let forwarded = false;
    if (this.forwardKeyboard && isChannelMessage && this.synthesiaOut) {
      forwarded = this.synthesiaOut.send(Array.from(bytes));
      if (forwarded) this.stats.forwarded++;
      else this.stats.forwardDropped++;
    }
    const event = parseMessage(bytes, 'keyboard', ts);
    if (!event) {
      this.stats.malformed++;
      return;
    }
    if (forwarded && this.echoGuardMs > 0) this.recentForwards.set(this.echoKey(event), ts);
    this.log('IN', 'keyboard', event, forwarded ? '  -> synthesia' : this.forwardKeyboard ? '  (not forwarded: out port down)' : '');
    this.engine.handle(event);
  }

  onSynthesia(bytes, ts = monotonicMs()) {
    this.stats.synthesiaIn++;
    this.lastSynthMessageAt = ts;
    const event = parseMessage(bytes, 'synthesia', ts);
    if (!event) {
      this.stats.malformed++;
      return;
    }
    if (this.echoGuardMs > 0 && this.isEcho(event, ts)) {
      this.stats.echoDropped++;
      this.log('IN', 'synthesia', event, '  (dropped: echo of keyboard)');
      return;
    }
    // Channel messages only; forwarded before the LED update to keep the sound as close as possible to the screen.
    const toKeyboard = this.forwardSynthesia && this.keyboardOut && bytes[0] >= 0x80 && bytes[0] < 0xf0 && this.forwardToKeyboard(bytes, event);
    this.log('IN', 'synthesia', event, toKeyboard ? '  -> keyboard' : '');
    this.engine.handle(event);
  }

  echoKey(event) {
    return event.type === 'noteon' || event.type === 'noteoff' ? `${event.type}:${event.channel}:${event.note}` : `${event.type}:${event.channel}:${event.controller}`;
  }

  isEcho(event, ts) {
    const key = this.echoKey(event);
    const at = this.recentForwards.get(key);
    if (at === undefined) return false;
    this.recentForwards.delete(key);
    return ts - at <= this.echoGuardMs;
  }

  checkStale() {
    if (this.lastSynthMessageAt === null) return;
    if (monotonicMs() - this.lastSynthMessageAt < this.synthStaleMs) return;
    const counts = this.engine.store.counts().synthesia;
    if (counts.pressed + counts.sustained === 0) return;
    this.stats.staleClears++;
    this.logger.warn(`[router] no Synthesia message for ${this.synthStaleMs} ms with notes active: clearing Synthesia LEDs`);
    this.engine.panic('synthesia');
  }
}

module.exports = { MidiRouter };
