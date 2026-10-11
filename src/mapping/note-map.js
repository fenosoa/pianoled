'use strict';

const { LED_COUNT } = require('../constants');

function isValidLed(index) {
  return Number.isInteger(index) && index >= 0 && index < LED_COUNT;
}

/**
 * Builds a note -> LED index function. Returns null for unmapped notes, never an index outside [0,79].
 * linear: led = offset + (note - baseNote), mirrored if reverse. Uncalibrated prototype default.
 * table:  explicit { "midiNote": ledIndex } entries, validated strictly at load time.
 */
function createNoteMapper({ mode = 'linear', baseNote = 21, offset = 0, reverse = false, table = null } = {}) {
  if (mode === 'table') {
    if (!table || typeof table !== 'object') throw new Error('table mapping requires a table object');
    const map = new Map();
    for (const [k, v] of Object.entries(table)) {
      const note = Number(k);
      if (!Number.isInteger(note) || note < 0 || note > 127) throw new Error(`note map: invalid MIDI note "${k}"`);
      if (!isValidLed(v)) throw new Error(`note map: LED index ${JSON.stringify(v)} for note ${k} outside [0,${LED_COUNT - 1}]`);
      map.set(note, v);
    }
    return {
      mode,
      ledForNote: (note) => (map.has(note) ? map.get(note) : null),
      describe: () => `table (${map.size} notes)`,
    };
  }

  if (mode !== 'linear') throw new Error(`unknown mapping mode "${mode}"`);
  if (!Number.isInteger(baseNote) || baseNote < 0 || baseNote > 127) throw new Error(`invalid baseNote ${baseNote}`);
  if (!Number.isInteger(offset)) throw new Error(`invalid offset ${offset}`);

  const ledForNote = (note) => {
    if (!Number.isInteger(note) || note < 0 || note > 127) return null;
    let idx = offset + (note - baseNote);
    if (!isValidLed(idx)) return null;
    if (reverse) idx = LED_COUNT - 1 - idx;
    return idx;
  };

  const mapped = [];
  for (let n = 0; n <= 127; n++) if (ledForNote(n) !== null) mapped.push(n);
  return {
    mode,
    ledForNote,
    describe: () =>
      mapped.length
        ? `linear base=${baseNote} offset=${offset} reverse=${reverse} -> notes ${mapped[0]}..${mapped[mapped.length - 1]}`
        : 'linear (no note mapped)',
  };
}

/** Notes that map to at least one LED, ascending. */
function mappedNotes(mapper) {
  const out = [];
  for (let n = 0; n <= 127; n++) if (mapper.ledForNote(n) !== null) out.push(n);
  return out;
}

module.exports = { createNoteMapper, mappedNotes, isValidLed };
