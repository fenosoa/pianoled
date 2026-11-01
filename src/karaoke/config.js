'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRgb, ConfigError } = require('../config');
const { parseChord } = require('./chord-parser');

const DEFAULTS = {
  enabled: false,
  wsUrl: 'ws://127.0.0.1:5180/sync',
  pauseTimeoutS: 30,
  fadeMs: 120,
  onNoChord: 'off',
  brightness: { pause: 1, karaoke: 0.25 },
  bassColor: '#FF0000',
  defaultColor: '#FFFFFF',
  chordColors: {},
  // Rainbow wave under idle / karaoke. speed in LEDs/s, wavelength in LEDs, fps = refresh rate of the animation.
  ripple: { enabled: true, brightness: 0.15, speed: 18, wavelength: 24, fps: 30 },
};

function num(value, name, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) throw new ConfigError(`karaoke.${name} must be a number in [${min},${max}], got ${JSON.stringify(value)}`);
  return value;
}

/** Validates a parsed karaoke.json (missing keys fall back to DEFAULTS). */
function normalizeKaraokeConfig(raw = {}) {
  const c = {
    ...DEFAULTS,
    ...raw,
    brightness: { ...DEFAULTS.brightness, ...(raw.brightness || {}) },
    ripple: { ...DEFAULTS.ripple, ...(raw.ripple || {}) },
  };
  if (typeof c.wsUrl !== 'string' || !/^wss?:\/\//.test(c.wsUrl)) throw new ConfigError(`karaoke.wsUrl must start with ws:// or wss://, got ${JSON.stringify(c.wsUrl)}`);
  if (!['off', 'hold'].includes(c.onNoChord)) throw new ConfigError(`karaoke.onNoChord must be "off" or "hold", got ${JSON.stringify(c.onNoChord)}`);
  const colors = new Map(); // `${rootPc}${minor ? 'm' : ''}` -> rgb, so C# and Db share a color
  for (const [name, value] of Object.entries(c.chordColors || {})) {
    const chord = parseChord(name);
    if (!chord) throw new ConfigError(`karaoke.chordColors: unknown chord "${name}"`);
    colors.set(`${chord.root}${chord.minor ? 'm' : ''}`, parseRgb(value, `karaoke.chordColors.${name}`));
  }
  return {
    enabled: !!c.enabled,
    wsUrl: c.wsUrl,
    pauseTimeoutMs: num(Number(c.pauseTimeoutS), 'pauseTimeoutS', 0, 86400) * 1000, // 0 = never time out
    fadeMs: num(Number(c.fadeMs), 'fadeMs', 0, 2000),
    onNoChord: c.onNoChord,
    pauseGain: num(Number(c.brightness.pause), 'brightness.pause', 0, 1),
    karaokeBrightness: num(Number(c.brightness.karaoke), 'brightness.karaoke', 0, 1),
    bassColor: parseRgb(c.bassColor, 'karaoke.bassColor'),
    defaultColor: parseRgb(c.defaultColor, 'karaoke.defaultColor'),
    colors,
    ripple: {
      enabled: !!c.ripple.enabled,
      brightness: num(Number(c.ripple.brightness), 'ripple.brightness', 0, 1),
      speed: num(Number(c.ripple.speed), 'ripple.speed', 0, 200),
      wavelength: num(Number(c.ripple.wavelength), 'ripple.wavelength', 2, 240),
      fps: num(Number(c.ripple.fps), 'ripple.fps', 1, 60),
    },
  };
}

function loadKaraokeConfig(file = process.env.KARAOKE_CONFIG || 'config/karaoke.json', baseDir = process.cwd()) {
  const full = path.resolve(baseDir, file);
  let raw = {};
  if (fs.existsSync(full)) {
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      throw new ConfigError(`karaoke config ${full}: ${err.message}`);
    }
  }
  return normalizeKaraokeConfig(raw);
}

module.exports = { loadKaraokeConfig, normalizeKaraokeConfig };
