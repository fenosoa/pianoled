'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PitchMapper, shiftNote, audioShiftOf, ledShiftOf, keyboardShiftOf } = require('../src/midi/pitch');
const { MidiRouter } = require('../src/adapters/router');
const { loadPitch, ConfigError } = require('../src/config');
const { makeEngine } = require('./helpers');

const P = (o = {}) => ({ audioTransposeSemitones: 0, audioOctaveShift: 0, keyboardPhysicalTransposeSemitones: 0, keyboardPhysicalOctaveShift: 0, ...o });

class FakeIn extends EventEmitter {}
class FakeOut {
  constructor() { this.sent = []; }
  send(bytes) { this.sent.push(bytes); return true; }
}

function setup(pitch) {
  const { engine } = makeEngine();
  const keyboardIn = new FakeIn();
  const synthesiaIn = new FakeIn();
  const synthesiaOut = new FakeOut();
  const keyboardOut = new FakeOut();
  const router = new MidiRouter({ engine, keyboardIn, synthesiaIn, synthesiaOut, keyboardOut, forwardSynthesia: true, pitch });
  router.start();
  const lit = (note) => engine.cell(engine.mapper.ledForNote(note))?.symbol || null;
  return { engine, router, keyboardIn, synthesiaIn, synthesiaOut, keyboardOut, lit };
}

test('pure helpers: bounds and shifts', () => {
  assert.equal(shiftNote(67, -3), 64);
  assert.equal(shiftNote(120, 12), null);
  assert.equal(shiftNote(3, -4), null);
  assert.equal(audioShiftOf(P({ audioTransposeSemitones: -3, audioOctaveShift: -1 })), -3);
  assert.equal(ledShiftOf(P({ audioOctaveShift: -1 })), -12);
  assert.equal(keyboardShiftOf(P({ keyboardPhysicalTransposeSemitones: -2, keyboardPhysicalOctaveShift: -1 })), -14);
});

test('loadPitch validates bounds', () => {
  assert.deepEqual(loadPitch({}), P());
  assert.throws(() => loadPitch({ AUDIO_OCTAVE_SHIFT: '4' }), ConfigError);
});

test('all zero: bytes untouched, same array', () => {
  const m = new PitchMapper();
  const b = [0x90, 60, 80];
  assert.equal(m.translate('syn', b, 0)[0], b);
});

test('Note Off closes the number actually emitted after a setting change', () => {
  const m = new PitchMapper();
  assert.deepEqual(m.translate('syn', [0x90, 67, 90], -3), [[0x90, 64, 90]]);
  assert.deepEqual(m.translate('syn', [0x80, 67, 0], 5), [[0x80, 64, 0]]);
  assert.deepEqual(m.translate('syn', [0x80, 67, 0], 5), [[0x80, 72, 0]]); // no entry: current shift fallback
});

test('out-of-range notes (and their Note Off) are ignored', () => {
  const m = new PitchMapper();
  assert.deepEqual(m.translate('syn', [0x90, 125, 90], 12), []);
  assert.deepEqual(m.translate('syn', [0x80, 125, 0], 0), []);
  assert.equal(m.tables.get('syn').size, 0);
});

test('re-struck held note after a setting change closes the old one first', () => {
  const m = new PitchMapper();
  m.translate('syn', [0x90, 60, 90], 0 + 1);
  assert.deepEqual(m.translate('syn', [0x90, 60, 90], 2), [[0x80, 61, 0], [0x90, 62, 90]]);
});

test('polyphonic aftertouch follows the emitted note; CC and others untouched', () => {
  const m = new PitchMapper();
  m.translate('syn', [0x90, 60, 90], 4);
  assert.deepEqual(m.translate('syn', [0xa0, 60, 33], 4), [[0xa0, 64, 33]]);
  assert.deepEqual(m.translate('syn', [0xa0, 61, 33], 4), []);
  const cc = [0xb0, 64, 127];
  assert.equal(m.translate('syn', cc, 4)[0], cc);
});

test('nominal scenario: PSR sends 64 (compensation +3) -> Synthesia and LED get 67; Synthesia 67 -> PSR 64, LED 67', () => {
  const { keyboardIn, synthesiaIn, synthesiaOut, keyboardOut, lit } = setup(P({ audioTransposeSemitones: -3, keyboardPhysicalTransposeSemitones: -3 }));
  keyboardIn.emit('message', [0x90, 64, 80], 1);
  assert.deepEqual(synthesiaOut.sent, [[0x90, 67, 80]]);
  assert.equal(lit(67), 'W');
  assert.equal(lit(64), null);
  synthesiaIn.emit('message', [0x91, 67, 90], 2);
  assert.deepEqual(keyboardOut.sent, [[0x91, 64, 90]]);
  assert.notEqual(lit(67), null);
  assert.equal(lit(64), null);
});

test('octave cases from the validation matrix', () => {
  const a = setup(P({ audioTransposeSemitones: -3, audioOctaveShift: -1 }));
  a.synthesiaIn.emit('message', [0x90, 67, 90], 1);
  assert.deepEqual(a.keyboardOut.sent, [[0x90, 64, 90]]); // octave never changes the sound
  assert.equal(a.lit(55), 'S');
  assert.equal(a.lit(67), null);
  const b = setup(P({ keyboardPhysicalTransposeSemitones: 3, keyboardPhysicalOctaveShift: 1 }));
  b.keyboardIn.emit('message', [0x90, 82, 80], 1);
  assert.deepEqual(b.synthesiaOut.sent, [[0x90, 67, 80]]);
  const c = setup(P({ keyboardPhysicalTransposeSemitones: -2, keyboardPhysicalOctaveShift: -1 }));
  c.keyboardIn.emit('message', [0x90, 53, 80], 1);
  assert.deepEqual(c.synthesiaOut.sent, [[0x90, 67, 80]]);
});

test('hot change during a held note: Note Off at the emitted number, no stuck note, LED released', () => {
  const { router, keyboardIn, synthesiaIn, synthesiaOut, keyboardOut, lit } = setup(P({ audioTransposeSemitones: -3, keyboardPhysicalTransposeSemitones: -3 }));
  keyboardIn.emit('message', [0x90, 64, 80], 1);
  synthesiaIn.emit('message', [0x90, 60, 80], 2);
  router.setPitch(P({ audioTransposeSemitones: 5 }));
  keyboardIn.emit('message', [0x80, 64, 0], 3);
  synthesiaIn.emit('message', [0x80, 60, 0], 4);
  assert.deepEqual(synthesiaOut.sent[1], [0x80, 67, 0]);
  assert.deepEqual(keyboardOut.sent[1], [0x80, 57, 0]);
  assert.equal(lit(67), null);
  router.stop();
  assert.equal(keyboardOut.sent.length, 2); // nothing left to release
});

test('stop releases the emitted (shifted) notes', () => {
  const { router, synthesiaIn, keyboardOut } = setup(P({ audioTransposeSemitones: 2 }));
  synthesiaIn.emit('message', [0x90, 60, 80], 1);
  router.stop();
  assert.deepEqual(keyboardOut.sent[1], [0x80, 62, 0]);
});

test('LED octave shift: hot change keeps the lit LED released by its own Note Off', () => {
  const { router, synthesiaIn, lit } = setup(P({ audioOctaveShift: 1 }));
  synthesiaIn.emit('message', [0x90, 48, 80], 1);
  assert.notEqual(lit(60), null);
  assert.equal(lit(48), null);
  router.setPitch(P());
  synthesiaIn.emit('message', [0x80, 48, 0], 2);
  assert.equal(lit(60), null);
});
