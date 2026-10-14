'use strict';

const { silentLogger } = require('../logger');

const DROPPED = -1;
const NOTE_KINDS = new Set([0x80, 0x90, 0xa0]);

/** note + delta, or null when the result leaves [0,127] (no wrap, no modulo, no clamp). */
function shiftNote(note, delta) {
  const n = note + delta;
  return n >= 0 && n <= 127 ? n : null;
}

/** Synthesia -> PSR sound shift, in semitones. */
function audioShiftOf(pitch) {
  return pitch.audioTransposeSemitones + 12 * pitch.audioOctaveShift;
}

/** Shift the PSR already applied on its MIDI OUT, in semitones. */
function keyboardShiftOf(pitch) {
  return pitch.keyboardPhysicalTransposeSemitones + 12 * pitch.keyboardPhysicalOctaveShift;
}

/**
 * Shifts note-carrying channel messages (Note On/Off, polyphonic aftertouch) and remembers which number
 * was actually emitted for each (group, channel, original note), so a Note Off always closes the note
 * that was opened even if the setting changed in between. Other messages pass through untouched.
 * Groups are independent tables ("kbd" = PSR -> reference, "syn" = Synthesia -> PSR).
 */
class PitchMapper {
  constructor({ logger = silentLogger, now = Date.now } = {}) {
    this.logger = logger;
    this.now = now;
    this.tables = new Map();
    this.lastLogAt = 0;
    this.stats = { dropped: 0 };
  }

  table(group) {
    let t = this.tables.get(group);
    if (!t) this.tables.set(group, (t = new Map()));
    return t;
  }

  /** Returns the messages to emit: [] (dropped), one message, or Note Off + Note On when a held note is re-struck with a new shift. */
  translate(group, bytes, shift) {
    const table = this.table(group);
    // Identity fast path: nothing shifted now and nothing pending, so behaviour is byte-for-byte the legacy one.
    if (shift === 0 && table.size === 0) return [bytes];
    const status = bytes[0];
    const kind = status & 0xf0;
    if (bytes.length < 3 || !NOTE_KINDS.has(kind)) return [bytes];
    const key = ((status & 0x0f) << 7) | bytes[1];
    const velocity = bytes[2];

    if (kind === 0x90 && velocity > 0) {
      const out = [];
      const prev = table.get(key);
      const next = shiftNote(bytes[1], shift);
      if (prev !== undefined && prev !== DROPPED && prev !== next) out.push([0x80 | (status & 0x0f), prev, 0]);
      if (next === null) {
        table.set(key, DROPPED);
        this.drop(bytes[1], shift);
        return out;
      }
      table.set(key, next);
      out.push([status, next, velocity]);
      return out;
    }

    const prev = table.get(key);
    if (kind === 0xa0) return prev === undefined || prev === DROPPED ? [] : [[status, prev, velocity]];

    // Note Off (0x80, or Note On with velocity 0)
    table.delete(key);
    const note = prev === undefined ? shiftNote(bytes[1], shift) : prev === DROPPED ? null : prev;
    return note === null ? [] : [[status, note, velocity]];
  }

  /** Note Off messages for everything still open in the group; the table is emptied. */
  releaseAll(group) {
    const table = this.table(group);
    const out = [];
    for (const [key, note] of table) if (note !== DROPPED) out.push([0x80 | (key >> 7), note, 0]);
    table.clear();
    return out;
  }

  clear(group) {
    this.table(group).clear();
  }

  drop(note, shift) {
    this.stats.dropped++;
    const t = this.now();
    if (t - this.lastLogAt < 1000) return;
    this.lastLogAt = t;
    this.logger.debug(`[pitch] note ${note} shifted by ${shift} leaves 0..127: ignored`);
  }
}

module.exports = { shiftNote, audioShiftOf, keyboardShiftOf, PitchMapper };
