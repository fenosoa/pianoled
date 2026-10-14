'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LED_COUNT, DDP_DEFAULT_PORT } = require('../constants');
const { loadEnvFile } = require('./env-file');

const NAMED_COLORS = {
  white: [255, 255, 255],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  red: [255, 0, 0],
  cyan: [0, 255, 255],
  yellow: [255, 200, 0],
  synthesia: [0x00, 0xcf, 0xf5], // #00CFF5
};

const DEFAULT_KEYBOARD_COLOR = [0xff, 0x4d, 0x9d]; // #FF4D9D
const DEFAULT_OVERLAP_COLOR = [0x00, 0xff, 0x00]; // #00FF00
const DEFAULT_SYNTH_BLACK_COLOR = [0x8a, 0x2b, 0xff]; // #8A2BFF

class ConfigError extends Error {}

function readInt(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be an integer in [${min},${max}], got "${raw}"`);
  }
  return n;
}

function readNumber(env, name, def, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be a number in [${min},${max}], got "${raw}"`);
  }
  return n;
}

function readBool(env, name, def) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(raw);
}

function readEnum(env, name, def, allowed) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!allowed.includes(raw)) throw new ConfigError(`${name} must be one of ${allowed.join('|')}, got "${raw}"`);
  return raw;
}

function parseRgb(value, name) {
  const v = String(value).trim().toLowerCase();
  if (NAMED_COLORS[v]) return NAMED_COLORS[v].slice();
  let m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(v);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(v);
  if (m) {
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (rgb.every((c) => c <= 255)) return rgb;
  }
  throw new ConfigError(`${name}: invalid color "${value}" (use r,g,b, #rrggbb or a name)`);
}

// "1:green,2:blue" (user-facing channels 1..16) -> { 0: 'green', 1: 'blue' } (code channels 0..15).
function parseChannelColors(raw, colorNames) {
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})\s*:\s*([a-z]+)$/i.exec(part);
    if (!m) throw new ConfigError(`SYNTH_CHANNEL_COLORS: invalid entry "${part}" (expected channel:color)`);
    const ch = Number(m[1]);
    const color = m[2].toLowerCase();
    if (ch < 1 || ch > 16) throw new ConfigError(`SYNTH_CHANNEL_COLORS: channel ${ch} outside 1..16`);
    if (!colorNames.includes(color)) {
      throw new ConfigError(`SYNTH_CHANNEL_COLORS: unknown color "${color}" (known: ${colorNames.join(', ')})`);
    }
    out[ch - 1] = color;
  }
  return out;
}

function loadNoteMapFile(file, baseDir) {
  const full = path.resolve(baseDir, file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    throw new ConfigError(`NOTE_MAP_FILE: cannot read ${full}: ${err.message}`);
  }
  const map = json && typeof json.map === 'object' ? json.map : json;
  const table = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith('_')) continue;
    table[k] = v;
  }
  return table;
}

// Pitch settings are hot-reloadable, so they have their own loader (also used by the control server).
function loadPitch(env = process.env) {
  return {
    audioTransposeSemitones: readInt(env, 'AUDIO_TRANSPOSE_SEMITONES', 0, -12, 12),
    audioOctaveShift: readInt(env, 'AUDIO_OCTAVE_SHIFT', 0, -3, 3),
    keyboardPhysicalTransposeSemitones: readInt(env, 'KEYBOARD_PHYSICAL_TRANSPOSE_SEMITONES', 0, -12, 12),
    keyboardPhysicalOctaveShift: readInt(env, 'KEYBOARD_PHYSICAL_OCTAVE_SHIFT', 0, -3, 3),
  };
}

function loadConfig(env = process.env, { baseDir = process.cwd() } = {}) {
  if (env.LED_COUNT !== undefined && env.LED_COUNT !== '' && Number(env.LED_COUNT) !== LED_COUNT) {
    throw new ConfigError(`LED_COUNT is fixed to ${LED_COUNT} during this phase (got ${env.LED_COUNT})`);
  }

  const colors = { ...NAMED_COLORS };
  if (env.COLOR_GREEN) colors.green = parseRgb(env.COLOR_GREEN, 'COLOR_GREEN');
  if (env.COLOR_BLUE) colors.blue = parseRgb(env.COLOR_BLUE, 'COLOR_BLUE');
  if (env.COLOR_SYNTHESIA) colors.synthesia = parseRgb(env.COLOR_SYNTHESIA, 'COLOR_SYNTHESIA');
  const keyboardColor = env.COLOR_KEYBOARD ? parseRgb(env.COLOR_KEYBOARD, 'COLOR_KEYBOARD') : DEFAULT_KEYBOARD_COLOR.slice();
  const overlapColor = env.COLOR_OVERLAP ? parseRgb(env.COLOR_OVERLAP, 'COLOR_OVERLAP') : DEFAULT_OVERLAP_COLOR.slice();
  const synthBlackColor = env.COLOR_SYNTHESIA_BLACK ? parseRgb(env.COLOR_SYNTHESIA_BLACK, 'COLOR_SYNTHESIA_BLACK') : DEFAULT_SYNTH_BLACK_COLOR.slice();
  const colorNames = Object.keys(colors);

  const synthDefault = (env.SYNTH_DEFAULT_COLOR || 'synthesia').toLowerCase();
  if (!colorNames.includes(synthDefault)) throw new ConfigError(`SYNTH_DEFAULT_COLOR: unknown color "${synthDefault}"`);

  const mappingMode = readEnum(env, 'MAPPING_MODE', env.NOTE_MAP_FILE ? 'table' : 'linear', ['linear', 'table']);
  if (mappingMode === 'table' && !env.NOTE_MAP_FILE) throw new ConfigError('MAPPING_MODE=table requires NOTE_MAP_FILE');

  return {
    ledCount: LED_COUNT,
    logLevel: readEnum(env, 'LOG_LEVEL', 'info', ['error', 'warn', 'info', 'debug']),
    ddp: {
      host: env.WLED_HOST || '192.168.1.41',
      port: readInt(env, 'DDP_PORT', DDP_DEFAULT_PORT, 1, 65535),
      fps: readNumber(env, 'FPS', 40, 1, 120),
      coalesceMs: readNumber(env, 'COALESCE_MS', 0, 0, 50),
      minFrameGapMs: readNumber(env, 'MIN_FRAME_GAP_MS', 5, 0, 100),
      keepalive: readEnum(env, 'KEEPALIVE', 'always', ['always', 'active', 'off']),
      idleKeepaliveMs: readInt(env, 'IDLE_KEEPALIVE_MS', 3000, 0, 600000),
      blackFramesOnStop: readInt(env, 'BLACK_FRAMES_ON_STOP', 3, 1, 20),
      dryRun: readBool(env, 'DRY_RUN', false),
    },
    colors: {
      named: colors,
      keyboard: keyboardColor,
      overlap: overlapColor,
      synthesiaBlack: synthBlackColor,
      overlapBoost: readNumber(env, 'OVERLAP_BOOST', 2, 0, 10),
      brightness: readNumber(env, 'BRIGHTNESS', 0.25, 0, 1),
    },
    synthesia: {
      defaultColor: synthDefault,
      channelColors: parseChannelColors(env.SYNTH_CHANNEL_COLORS, colorNames),
    },
    mapping: {
      mode: mappingMode,
      baseNote: readInt(env, 'MIDI_BASE_NOTE', 21, 0, 127),
      offset: readInt(env, 'LED_OFFSET', 0, -127, LED_COUNT - 1),
      reverse: readBool(env, 'LED_REVERSE', false),
      table: mappingMode === 'table' ? loadNoteMapFile(env.NOTE_MAP_FILE, baseDir) : null,
    },
    pitch: loadPitch(env),
    sustainMode: readEnum(env, 'SUSTAIN_MODE', 'keys', ['keys', 'sound']),
    midi: {
      keyboardIn: env.KEYBOARD_IN_PORT || '',
      synthesiaIn: env.SYNTHESIA_IN_PORT || '',
      synthesiaOut: env.SYNTHESIA_OUT_PORT || '',
      forwardKeyboard: readBool(env, 'FORWARD_KEYBOARD', true),
      // Opt-in: play Synthesia's notes on the keyboard's own sound engine (keyboard MIDI out).
      forwardSynthesia: readBool(env, 'FORWARD_SYNTHESIA', false),
      keyboardOut: env.KEYBOARD_OUT_PORT || env.KEYBOARD_IN_PORT || '',
      pollMs: readInt(env, 'PORT_POLL_MS', 2000, 200, 60000),
      echoGuardMs: readInt(env, 'ECHO_GUARD_MS', 0, 0, 1000),
      synthStaleMs: readInt(env, 'SYNTH_STALE_MS', 0, 0, 3600000),
    },
  };
}

function loadConfigFromProject({ envFile = process.env.ENV_FILE || '.env', env = process.env, baseDir = process.cwd() } = {}) {
  loadEnvFile(path.resolve(baseDir, envFile), env);
  return loadConfig(env, { baseDir });
}

module.exports = { loadConfig, loadPitch, loadConfigFromProject, parseRgb, parseChannelColors, ConfigError, NAMED_COLORS };
