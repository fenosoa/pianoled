'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NoteStateStore } = require('../src/state/note-state');
const { noteOn, noteOff, controlChange } = require('../src/midi/messages');

const lit = (store, source) => [...store.litNotes(source).keys()].sort((a, b) => a - b);

test('sources are independent: releasing one never clears the other', () => {
  const s = new NoteStateStore();
  s.apply(noteOn('keyboard', 60));
  s.apply(noteOn('synthesia', 60));
  s.apply(noteOff('keyboard', 60));
  assert.deepEqual(lit(s, 'keyboard'), []);
  assert.deepEqual(lit(s, 'synthesia'), [60]);
});

test('polyphony and per-channel tracking', () => {
  const s = new NoteStateStore();
  [60, 64, 67].forEach((n) => s.apply(noteOn('synthesia', n, 90, 0)));
  s.apply(noteOn('synthesia', 60, 90, 1));
  s.apply(noteOff('synthesia', 60, 0, 0));
  assert.deepEqual(lit(s, 'synthesia'), [60, 64, 67]);
  assert.deepEqual(s.litNotes('synthesia').get(60), [1]);
});

test('repeated note on is idempotent; first note off releases', () => {
  const s = new NoteStateStore();
  s.apply(noteOn('keyboard', 60));
  assert.equal(s.apply(noteOn('keyboard', 60)), false);
  assert.equal(s.apply(noteOff('keyboard', 60)), true);
  assert.equal(s.apply(noteOff('keyboard', 60)), false);
  assert.deepEqual(lit(s, 'keyboard'), []);
});

test('sustain mode "keys": LED follows physical keys only', () => {
  const s = new NoteStateStore({ sustainMode: 'keys' });
  s.apply(controlChange('keyboard', 64, 127));
  s.apply(noteOn('keyboard', 60));
  s.apply(noteOff('keyboard', 60));
  assert.deepEqual(lit(s, 'keyboard'), []);
  assert.equal(s.counts().keyboard.sustained, 1);
});

test('sustain mode "sound": sustained notes stay lit until pedal up; re-press keeps it', () => {
  const s = new NoteStateStore({ sustainMode: 'sound' });
  s.apply(controlChange('keyboard', 64, 100));
  s.apply(noteOn('keyboard', 60));
  s.apply(noteOff('keyboard', 60));
  assert.deepEqual(lit(s, 'keyboard'), [60]);
  s.apply(noteOn('keyboard', 62));
  s.apply(controlChange('keyboard', 64, 0));
  assert.deepEqual(lit(s, 'keyboard'), [62]);
  // pedal on channel 0 does not sustain channel 1
  s.apply(controlChange('keyboard', 64, 127, 0));
  s.apply(noteOn('keyboard', 70, 100, 1));
  s.apply(noteOff('keyboard', 70, 0, 1));
  assert.deepEqual(lit(s, 'keyboard'), [62]);
});

test('All Notes Off / All Sound Off clear only that source and channel', () => {
  const s = new NoteStateStore({ sustainMode: 'sound' });
  s.apply(noteOn('synthesia', 60, 90, 0));
  s.apply(noteOn('synthesia', 61, 90, 1));
  s.apply(noteOn('keyboard', 60));
  s.apply(controlChange('synthesia', 123, 0, 0));
  assert.deepEqual(lit(s, 'synthesia'), [61]);
  s.apply(controlChange('synthesia', 120, 0, 1));
  assert.deepEqual(lit(s, 'synthesia'), []);
  assert.deepEqual(lit(s, 'keyboard'), [60]);
});

test('Reset All Controllers releases the pedal', () => {
  const s = new NoteStateStore({ sustainMode: 'sound' });
  s.apply(controlChange('keyboard', 64, 127));
  s.apply(noteOn('keyboard', 60));
  s.apply(noteOff('keyboard', 60));
  s.apply(controlChange('keyboard', 121, 0));
  assert.deepEqual(lit(s, 'keyboard'), []);
});

test('clearSource / clearAll', () => {
  const s = new NoteStateStore();
  s.apply(noteOn('keyboard', 60));
  s.apply(noteOn('synthesia', 61));
  assert.equal(s.clearSource('synthesia'), true);
  assert.deepEqual(lit(s, 'keyboard'), [60]);
  assert.equal(s.clearAll(), true);
  assert.deepEqual(lit(s, 'keyboard'), []);
  assert.throws(() => s.clearSource('other'));
});
