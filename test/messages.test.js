'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, noteOn, toBytes, controlChange } = require('../src/midi/messages');

test('note on with velocity 0 is normalized to note off', () => {
  const ev = parseMessage([0x93, 60, 0], 'keyboard', 5);
  assert.equal(ev.type, 'noteoff');
  assert.equal(ev.channel, 3);
  assert.equal(ev.note, 60);
  assert.equal(ev.timestamp, 5);
  assert.equal(noteOn('keyboard', 60, 0).type, 'noteoff');
});

test('note on / note off / cc parsing keeps channel 0..15', () => {
  assert.deepEqual(
    (({ type, note, velocity, channel }) => ({ type, note, velocity, channel }))(parseMessage([0x9f, 21, 127], 'synthesia')),
    { type: 'noteon', note: 21, velocity: 127, channel: 15 }
  );
  assert.equal(parseMessage([0x80, 21, 64], 'synthesia').type, 'noteoff');
  const cc = parseMessage([0xb1, 64, 127], 'keyboard');
  assert.equal(cc.type, 'cc');
  assert.equal(cc.controller, 64);
  assert.equal(cc.channel, 1);
});

test('system, short and malformed messages are rejected; other channel messages kept as "other"', () => {
  assert.equal(parseMessage([0xf8], 'keyboard'), null);
  assert.equal(parseMessage([0xf0, 1, 2, 0xf7], 'keyboard'), null);
  assert.equal(parseMessage([0x90, 60], 'keyboard'), null);
  assert.equal(parseMessage([0x90, 200, 1], 'keyboard'), null);
  assert.equal(parseMessage([0xe0, 0, 64], 'keyboard').type, 'other');
  assert.throws(() => parseMessage([0x90, 60, 1], 'mixed'));
});

test('toBytes round-trips without altering notes', () => {
  for (const bytes of [[0x95, 61, 33], [0x85, 61, 12], [0xb2, 64, 0], [0xe3, 1, 2]]) {
    assert.deepEqual(toBytes(parseMessage(bytes, 'keyboard')), bytes);
  }
  assert.deepEqual(toBytes(controlChange('keyboard', 123, 0, 9)), [0xb9, 123, 0]);
});
