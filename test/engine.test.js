'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('./helpers');
const { noteOn, noteOff, controlChange } = require('../src/midi/messages');

const rgbAt = (engine, led) => [...engine.frame.pixels.subarray(led * 3, led * 3 + 3)];

test('priority white > synthesia > off with color restore (overlap scenario)', () => {
  const { engine } = makeEngine({ SYNTH_CHANNEL_COLORS: '1:green,2:blue' });
  const led = engine.mapper.ledForNote(60);
  engine.handle(noteOn('synthesia', 60, 90, 1));
  assert.deepEqual(rgbAt(engine, led), [0, 0, 255]);
  engine.handle(noteOn('keyboard', 60));
  assert.deepEqual(rgbAt(engine, led), [255, 255, 255]);
  engine.handle(noteOff('keyboard', 60));
  assert.deepEqual(rgbAt(engine, led), [0, 0, 255]);
  engine.handle(noteOff('synthesia', 60, 0, 1));
  assert.deepEqual(rgbAt(engine, led), [0, 0, 0]);
});

test('synthesia color per channel; default color for unconfigured channels; lowest channel wins', () => {
  const { engine } = makeEngine({ SYNTH_CHANNEL_COLORS: '2:blue', SYNTH_DEFAULT_COLOR: 'green' });
  engine.handle(noteOn('synthesia', 50, 90, 0));
  engine.handle(noteOn('synthesia', 52, 90, 1));
  engine.handle(noteOn('synthesia', 54, 90, 1));
  engine.handle(noteOn('synthesia', 54, 90, 0));
  assert.equal(engine.cell(engine.mapper.ledForNote(50)).symbol, 'G');
  assert.equal(engine.cell(engine.mapper.ledForNote(52)).symbol, 'B');
  assert.equal(engine.cell(engine.mapper.ledForNote(54)).symbol, 'G');
});

test('brightness scales colors', () => {
  const { engine } = makeEngine({ BRIGHTNESS: '0.1' });
  engine.handle(noteOn('keyboard', 60));
  assert.deepEqual(rgbAt(engine, engine.mapper.ledForNote(60)), [26, 26, 26]);
});

test('unmapped notes do not alter the frame and are counted', () => {
  const { engine } = makeEngine({ MIDI_BASE_NOTE: '21' });
  const before = Buffer.from(engine.frame.pixels);
  engine.handle(noteOn('keyboard', 10));
  engine.handle(noteOn('synthesia', 5));
  assert.ok(engine.frame.pixels.equals(before));
  assert.equal(engine.snapshot().stats.unmapped, 2);
});

test('frame changes trigger one DDP frame; unchanged state sends nothing extra', async () => {
  const { engine, transport } = makeEngine();
  engine.start();
  const initial = transport.packets.length;
  engine.handle(noteOn('keyboard', 60));
  engine.handle(noteOn('keyboard', 64));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transport.packets.length, initial + 1);
  engine.handle(noteOn('keyboard', 60)); // repeat: no visible change
  engine.handle(controlChange('keyboard', 7, 100)); // volume CC: no visible change
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transport.packets.length, initial + 1);
  const last = transport.packets.at(-1);
  assert.equal(last.length, 367);
  await engine.stop();
  assert.ok(transport.packets.at(-1).subarray(10).every((b) => b === 0));
});

test('panic(source) keeps the other source lit', () => {
  const { engine } = makeEngine();
  engine.handle(noteOn('keyboard', 60));
  engine.handle(noteOn('synthesia', 62));
  engine.panic('keyboard');
  assert.equal(engine.cell(engine.mapper.ledForNote(60)), null);
  assert.equal(engine.cell(engine.mapper.ledForNote(62)).symbol, 'G');
  engine.panic();
  assert.match(engine.ledString(), /^\.{119}$/);
});

test('table mapping via NOTE_MAP_FILE', () => {
  const { engine } = makeEngine({ NOTE_MAP_FILE: 'config/note-map.example.json' });
  assert.equal(engine.mapper.mode, 'table');
  engine.handle(noteOn('keyboard', 60));
  assert.equal(engine.cell(engine.mapper.ledForNote(60)).symbol, 'W');
});
