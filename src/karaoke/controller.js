'use strict';

const { LED_COUNT, FRAME_BYTES } = require('../constants');
const { scale } = require('../render/renderer');
const { parseChord } = require('./chord-parser');
const { RippleEffect } = require('./ripple');

const FADE_STEP_MS = 20;

/**
 * Builds the frame for a chord: every key whose pitch class belongs to the chord is lit, on all octaves.
 * The bass note is red on the left half of the keyboard (lowest notes) only; the right half keeps the chord color.
 */
function renderChordFrame(chord, mapper, cfg) {
  const pixels = Buffer.alloc(FRAME_BYTES);
  const cells = new Array(LED_COUNT).fill(null);
  const base = scale(cfg.colors.get(`${chord.root}${chord.minor ? 'm' : ''}`) || cfg.colors.get(`${chord.root}`) || cfg.defaultColor, cfg.karaokeBrightness);
  const bassRgb = scale(cfg.bassColor, cfg.karaokeBrightness);
  const pcs = new Set(chord.pcs);

  const notes = [];
  for (let n = 0; n <= 127; n++) if (mapper.ledForNote(n) !== null) notes.push(n);
  const half = notes[Math.floor(notes.length / 2)];

  for (const n of notes) {
    if (!pcs.has(n % 12)) continue;
    const led = mapper.ledForNote(n);
    const isBass = chord.bass !== null && n % 12 === chord.bass && n < half;
    const rgb = isBass ? bassRgb : base;
    pixels[led * 3] = rgb[0];
    pixels[led * 3 + 1] = rgb[1];
    pixels[led * 3 + 2] = rgb[2];
    cells[led] = { name: 'karaoke', symbol: isBass ? 'R' : 'K', rgb };
  }
  return { pixels, cells };
}

const blackFrame = () => ({ pixels: Buffer.alloc(FRAME_BYTES), cells: new Array(LED_COUNT).fill(null) });

/**
 * Three modes: IDLE (default; MIDI -> LEDs for now, ripple effects later), SYNTHESIA (forced by hand: MIDI -> LEDs, chord / song /
 * automatic idle messages ignored until a manual idle) and KARAOKE (LEDs dictated by the chord
 * received over WebSocket; MIDI still feeds the engine state but never reaches the LEDs).
 */
class KaraokeController {
  constructor({ engine, config, logger, now = Date.now }) {
    this.engine = engine;
    this.cfg = config;
    this.logger = logger;
    this.now = now;
    this.mode = 'IDLE';
    this.chordName = null; // last chord message shown (raw string), to ignore repeats
    this.displayed = blackFrame();
    this.fadeTimer = null;
    this.pauseTimer = null;
    engine.setPauseGain(config.pauseGain);

    this.ripple = config.ripple.enabled ? new RippleEffect({ mapper: engine.mapper, config: config.ripple, now }) : null;
    this.rippleTimer = null;
    if (this.ripple) {
      // Rings only react to keys played on the keyboard (Synthesia notes are not "played").
      engine.onNote((e) => e.source === 'keyboard' && this.ripple.noteOn(e.note, e.velocity));
      this.startRipple();
    }
  }

  /** Rainbow wave behind IDLE / KARAOKE; SYNTHESIA never has it. */
  startRipple() {
    if (!this.ripple || this.rippleTimer) return;
    this.ripple.reset();
    this.ripple.setReactive(this.mode === 'IDLE');
    this.ripple.tick();
    this.rippleTimer = setInterval(() => {
      this.ripple.tick();
      this.engine.refresh();
    }, 1000 / this.cfg.ripple.fps);
    this.rippleTimer.unref?.();
    this.engine.setBackground(() => this.ripple.pixels);
  }

  stopRipple() {
    if (!this.rippleTimer) return;
    clearInterval(this.rippleTimer);
    this.rippleTimer = null;
    this.engine.setBackground(null);
  }

  /** Raw WebSocket text -> state change. Invalid / foreign messages are ignored (logged when invalid). */
  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.logger.warn(`[karaoke] invalid JSON ignored: ${String(raw).slice(0, 80)}`);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    // Forced synthesia is sticky: only a manual idle (Stream Deck) leaves it, never the player's own idle / chords.
    if (this.mode === 'SYNTHESIA' && msg.type !== 'synthesia' && !(msg.type === 'idle' && msg.manual)) return;
    switch (msg.type) {
      case 'synthesia':
        this.enterIdle('synthesia received (manual)', 'SYNTHESIA');
        break;
      case 'song':
        this.enterKaraoke('song received');
        this.armTimeout();
        break;
      case 'chord':
        this.enterKaraoke('chord received');
        this.armTimeout();
        this.showChord(msg.chord);
        break;
      case 'idle':
        this.enterIdle(msg.manual ? 'idle received (manual)' : 'idle received');
        break;
      default:
        break; // the hub also carries state / queue / command messages
    }
  }

  /** Mode applied once at startup (DEFAULT_MODE). IDLE is the constructor's state; KARAOKE waits for chords without timing out. */
  applyDefaultMode(mode) {
    if (mode === 'SYNTHESIA') this.enterIdle('default mode', 'SYNTHESIA');
    else if (mode === 'KARAOKE') this.enterKaraoke('default mode');
  }

  onDisconnect() {
    this.enterIdle('websocket disconnected');
  }

  enterKaraoke(cause) {
    if (this.mode === 'KARAOKE') return;
    this.logger.info(`[karaoke] mode ${this.mode} -> KARAOKE (${cause})`);
    this.mode = 'KARAOKE';
    this.ripple?.setReactive(false);
    this.displayed = blackFrame();
    this.chordName = null;
    this.engine.setOverride(this.displayed);
  }

  enterIdle(cause, mode = 'IDLE') {
    clearTimeout(this.pauseTimer);
    if (this.mode === mode) return;
    this.logger.info(`[karaoke] mode ${this.mode} -> ${mode} (${cause})`);
    this.mode = mode;
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.chordName = null;
    if (mode === 'SYNTHESIA') this.stopRipple();
    else {
      this.startRipple();
      this.ripple?.setReactive(true);
    }
    this.engine.setOverride(null);
  }

  armTimeout() {
    clearTimeout(this.pauseTimer);
    if (!this.cfg.pauseTimeoutMs) return;
    this.pauseTimer = setTimeout(() => this.enterIdle(`no chord for ${this.cfg.pauseTimeoutMs / 1000}s`), this.cfg.pauseTimeoutMs);
  }

  showChord(name) {
    if (name === this.chordName) return;
    const chord = parseChord(name);
    if (!chord) {
      this.logger.debug(`[karaoke] no/unknown chord ${JSON.stringify(name)}`);
      this.chordName = name;
      if (this.cfg.onNoChord === 'off') this.fadeTo(blackFrame());
      return;
    }
    this.chordName = name;
    this.logger.debug(`[karaoke] chord ${name} -> pitch classes ${chord.pcs.join(',')}`);
    this.fadeTo(renderChordFrame(chord, this.engine.mapper, this.cfg));
  }

  fadeTo(target) {
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.cfg.fadeMs <= 0) {
      this.displayed = target;
      this.engine.setOverride(target);
      return;
    }
    const from = Buffer.from(this.displayed.pixels);
    const start = this.now();
    const step = () => {
      const t = Math.min(1, (this.now() - start) / this.cfg.fadeMs);
      const pixels = Buffer.alloc(FRAME_BYTES);
      for (let i = 0; i < FRAME_BYTES; i++) pixels[i] = Math.round(from[i] + (target.pixels[i] - from[i]) * t);
      this.displayed = t >= 1 ? target : { pixels, cells: target.cells };
      this.engine.setOverride(this.displayed);
      if (t >= 1) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
    };
    this.fadeTimer = setInterval(step, FADE_STEP_MS);
    step();
  }

  stop() {
    clearTimeout(this.pauseTimer);
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.stopRipple();
  }
}

module.exports = { KaraokeController, renderChordFrame };
