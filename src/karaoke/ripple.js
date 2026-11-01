'use strict';

const { LED_COUNT, FRAME_BYTES } = require('../constants');

const HUE_SPAN_LEDS = 60; // LEDs for one full rainbow turn
const WAVE_FLOOR = 0.3; // dimmest point of the wave (fraction of its peak)
const PULSE_SPEED = 70; // LEDs/s, expansion of a ring born from a played key
const PULSE_WIDTH = 3.5; // LEDs, half-width of the ring
const PULSE_LIFE_MS = 1400;
const MAX_PULSES = 24;
const ACTIVITY_PER_NOTE = 0.3;
const ACTIVITY_DECAY_MS = 1500;
const ACTIVITY_SPEEDUP = 2.5; // wave runs up to (1 + 2.5)x faster while playing

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [r * 255, g * 255, b * 255];
}

/**
 * Ambient animation: a rainbow wave travelling left -> right (increasing LED index) over every LED.
 * In IDLE it also reacts to the keys played: each note launches a ring of its pitch-class color from its key,
 * and the wave speeds up while playing. In KARAOKE it is the plain wave (the chord keys are drawn over it by the engine).
 * `pixels` holds the last computed frame; call tick() to advance it.
 */
class RippleEffect {
  constructor({ mapper, config, now = Date.now }) {
    this.mapper = mapper;
    this.cfg = config;
    this.now = now;
    this.pixels = Buffer.alloc(FRAME_BYTES);
    this.reactive = true;
    this.reset();
  }

  reset() {
    this.phase = 0; // LEDs travelled by the wave
    this.activity = 0; // 0..1, decays with time
    this.pulses = [];
    this.last = null;
  }

  /** IDLE reacts to played keys, KARAOKE does not. Switching drops pending rings. */
  setReactive(reactive) {
    this.reactive = reactive;
    this.pulses = [];
    this.activity = 0;
  }

  noteOn(note, velocity = 100) {
    if (!this.reactive) return;
    const led = this.mapper.ledForNote(note);
    if (led === null) return;
    this.activity = Math.min(1, this.activity + ACTIVITY_PER_NOTE);
    this.pulses.push({ led, born: this.now(), hue: (note % 12) / 12, amp: 0.5 + 0.5 * Math.min(1, velocity / 127) });
    if (this.pulses.length > MAX_PULSES) this.pulses.shift();
  }

  tick(t = this.now()) {
    const dt = this.last === null ? 0 : Math.min(250, Math.max(0, t - this.last));
    this.last = t;
    this.activity *= Math.exp(-dt / ACTIVITY_DECAY_MS);
    this.phase += (this.cfg.speed * (1 + ACTIVITY_SPEEDUP * this.activity) * dt) / 1000;
    this.pulses = this.pulses.filter((p) => t - p.born < PULSE_LIFE_MS);

    const peak = this.cfg.brightness;
    const pulseGain = Math.min(1, peak * 3);
    const px = this.pixels;
    for (let i = 0; i < LED_COUNT; i++) {
      const s = i - this.phase; // constant s moves toward higher LED indices as phase grows
      const level = WAVE_FLOOR + (1 - WAVE_FLOOR) * (0.5 + 0.5 * Math.sin((2 * Math.PI * s) / this.cfg.wavelength));
      const hue = (((s / HUE_SPAN_LEDS) % 1) + 1) % 1;
      const rgb = hsvToRgb(hue, 0.9, level * peak);
      for (const p of this.pulses) {
        const age = t - p.born;
        const d = (Math.abs(i - p.led) - (PULSE_SPEED * age) / 1000) / PULSE_WIDTH;
        const k = p.amp * pulseGain * Math.exp(-d * d) * (1 - age / PULSE_LIFE_MS);
        if (k < 0.01) continue;
        const c = hsvToRgb(p.hue, 1, k);
        rgb[0] += c[0];
        rgb[1] += c[1];
        rgb[2] += c[2];
      }
      px[i * 3] = Math.min(255, Math.round(rgb[0]));
      px[i * 3 + 1] = Math.min(255, Math.round(rgb[1]));
      px[i * 3 + 2] = Math.min(255, Math.round(rgb[2]));
    }
    return px;
  }
}

module.exports = { RippleEffect, hsvToRgb };
