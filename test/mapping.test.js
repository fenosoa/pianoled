'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNoteMapper, mappedNotes } = require('../src/mapping/note-map');

test('linear mapping: base note -> LED 0, 80 notes, outside ignored', () => {
  const m = createNoteMapper({ mode: 'linear', baseNote: 21 });
  assert.equal(m.ledForNote(21), 0);
  assert.equal(m.ledForNote(100), 79);
  assert.equal(m.ledForNote(20), null);
  assert.equal(m.ledForNote(101), null);
  assert.equal(mappedNotes(m).length, 80);
});

test('linear mapping with offset and reverse never leaves [0,79]', () => {
  const m = createNoteMapper({ mode: 'linear', baseNote: 60, offset: 10, reverse: true });
  assert.equal(m.ledForNote(60), 69);
  assert.equal(m.ledForNote(50), 79);
  assert.equal(m.ledForNote(49), null);
  for (let n = 0; n <= 127; n++) {
    const led = m.ledForNote(n);
    if (led !== null) assert.ok(led >= 0 && led <= 79);
  }
  assert.equal(m.ledForNote(-1), null);
  assert.equal(m.ledForNote(60.5), null);
});

test('table mapping: explicit entries only, strict validation', () => {
  const m = createNoteMapper({ mode: 'table', table: { 60: 0, 61: 2, 62: 79 } });
  assert.equal(m.ledForNote(60), 0);
  assert.equal(m.ledForNote(61), 2);
  assert.equal(m.ledForNote(63), null);
  assert.throws(() => createNoteMapper({ mode: 'table', table: { 60: 80 } }), /outside/);
  assert.throws(() => createNoteMapper({ mode: 'table', table: { 60: -1 } }), /outside/);
  assert.throws(() => createNoteMapper({ mode: 'table', table: { 60: 1.5 } }), /outside/);
  assert.throws(() => createNoteMapper({ mode: 'table', table: { 128: 1 } }), /invalid MIDI note/);
});
