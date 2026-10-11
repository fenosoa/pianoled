'use strict';

const { SOURCES } = require('../constants');

// Channel convention: 0..15 everywhere in code, 1..16 only in user-facing config and logs.
const CC = Object.freeze({
  SUSTAIN: 64,
  ALL_SOUND_OFF: 120,
  RESET_ALL_CONTROLLERS: 121,
  ALL_NOTES_OFF: 123,
});

function isDataByte(b) {
  return Number.isInteger(b) && b >= 0 && b <= 0x7f;
}

function assertSource(source) {
  if (!SOURCES.includes(source)) throw new Error(`unknown source "${source}"`);
}

/**
 * Converts one complete MIDI message (array of bytes) into a normalized event.
 * Returns null for system messages and malformed data.
 */
function parseMessage(bytes, source, timestamp = 0) {
  assertSource(source);
  if (!bytes || bytes.length === 0) return null;
  const status = bytes[0];
  if (status < 0x80 || status >= 0xf0) return null;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const raw = Array.from(bytes);
  const base = { source, channel, timestamp, raw };

  switch (kind) {
    case 0x80:
    case 0x90: {
      if (bytes.length < 3 || !isDataByte(bytes[1]) || !isDataByte(bytes[2])) return null;
      const velocity = bytes[2];
      const type = kind === 0x90 && velocity > 0 ? 'noteon' : 'noteoff';
      return { ...base, type, note: bytes[1], velocity };
    }
    case 0xb0: {
      if (bytes.length < 3 || !isDataByte(bytes[1]) || !isDataByte(bytes[2])) return null;
      return { ...base, type: 'cc', controller: bytes[1], value: bytes[2] };
    }
    default:
      // Program change, aftertouch, pitch bend: not used for LEDs but kept for routing/diagnostics.
      return { ...base, type: 'other', status: kind };
  }
}

function noteOn(source, note, velocity = 100, channel = 0, timestamp = 0) {
  return makeNote(source, 'noteon', note, velocity, channel, timestamp);
}

function noteOff(source, note, velocity = 0, channel = 0, timestamp = 0) {
  return makeNote(source, 'noteoff', note, velocity, channel, timestamp);
}

function makeNote(source, type, note, velocity, channel, timestamp) {
  assertSource(source);
  if (!isDataByte(note)) throw new Error(`invalid note ${note}`);
  if (!isDataByte(velocity)) throw new Error(`invalid velocity ${velocity}`);
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`invalid channel ${channel}`);
  // A Note On with velocity 0 is a Note Off.
  const effective = type === 'noteon' && velocity === 0 ? 'noteoff' : type;
  return { source, type: effective, note, velocity, channel, timestamp };
}

function controlChange(source, controller, value, channel = 0, timestamp = 0) {
  assertSource(source);
  if (!isDataByte(controller) || !isDataByte(value)) throw new Error('invalid controller/value');
  if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new Error(`invalid channel ${channel}`);
  return { source, type: 'cc', controller, value, channel, timestamp };
}

function toBytes(event) {
  if (event.raw) return event.raw.slice();
  switch (event.type) {
    case 'noteon':
      return [0x90 | event.channel, event.note, event.velocity];
    case 'noteoff':
      return [0x80 | event.channel, event.note, event.velocity || 0];
    case 'cc':
      return [0xb0 | event.channel, event.controller, event.value];
    default:
      throw new Error(`cannot encode event type ${event.type}`);
  }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function describe(event) {
  const ch = `ch${event.channel + 1}`;
  switch (event.type) {
    case 'noteon':
    case 'noteoff':
      return `${event.type.padEnd(7)} ${ch.padEnd(4)} note=${event.note}(${noteName(event.note)}) vel=${event.velocity}`;
    case 'cc':
      return `cc      ${ch.padEnd(4)} cc=${event.controller} val=${event.value}`;
    default:
      return `other   ${ch.padEnd(4)} raw=${(event.raw || []).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
  }
}

module.exports = { CC, parseMessage, noteOn, noteOff, controlChange, toBytes, noteName, describe };
