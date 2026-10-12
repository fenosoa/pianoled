'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, parseChannelColors, parseRgb, ConfigError } = require('../src/config');
const { parseEnv } = require('../src/config/env-file');

test('documented defaults', () => {
  const c = loadConfig({});
  assert.equal(c.ledCount, 120);
  assert.equal(c.ddp.host, '192.168.1.41');
  assert.equal(c.ddp.port, 4048);
  assert.equal(c.ddp.fps, 40);
  assert.equal(c.mapping.mode, 'linear');
  assert.equal(c.mapping.baseNote, 21);
  assert.equal(c.synthesia.defaultColor, 'synthesia')
  assert.deepEqual(c.colors.named.synthesia, [0x00, 0xcf, 0xf5]);
  assert.deepEqual(c.colors.keyboard, [0xff, 0x4d, 0x9d]);
  assert.deepEqual(c.colors.overlap, [0xc5, 0xff, 0x58]);;
  assert.deepEqual(c.synthesia.channelColors, {});
  assert.equal(c.sustainMode, 'keys');
});

test('LED_COUNT cannot be changed', () => {
  assert.throws(() => loadConfig({ LED_COUNT: '798' }), ConfigError);
  assert.equal(loadConfig({ LED_COUNT: '120' }).ledCount, 120);
});

test('channel colors use 1..16 in config and 0..15 in code', () => {
  assert.deepEqual(parseChannelColors('1:green, 2:blue', ['green', 'blue']), { 0: 'green', 1: 'blue' });
  assert.throws(() => parseChannelColors('0:green', ['green']), ConfigError);
  assert.throws(() => parseChannelColors('17:green', ['green']), ConfigError);
  assert.throws(() => parseChannelColors('1:pink', ['green']), ConfigError);
});

test('color parsing', () => {
  assert.deepEqual(parseRgb('0,25,0', 'x'), [0, 25, 0]);
  assert.deepEqual(parseRgb('#0000ff', 'x'), [0, 0, 255]);
  assert.deepEqual(parseRgb('white', 'x'), [255, 255, 255]);
  assert.throws(() => parseRgb('300,0,0', 'x'), ConfigError);
});

test('invalid numeric values are rejected', () => {
  assert.throws(() => loadConfig({ FPS: '0' }), ConfigError);
  assert.throws(() => loadConfig({ DDP_PORT: 'abc' }), ConfigError);
  assert.throws(() => loadConfig({ MAPPING_MODE: 'table' }), ConfigError);
});

test('.env parser', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB="x y"\nC=z # comment\n\nbad\n'), { A: '1', B: 'x y', C: 'z' });
});

test('FORWARD_SYNTHESIA is off by default; KEYBOARD_OUT_PORT falls back to KEYBOARD_IN_PORT', () => {
  assert.equal(loadConfig({}).midi.forwardSynthesia, false);
  const m = loadConfig({ FORWARD_SYNTHESIA: '1', KEYBOARD_IN_PORT: 'Digital Keyboard' }).midi;
  assert.equal(m.forwardSynthesia, true);
  assert.equal(m.keyboardOut, 'Digital Keyboard');
  assert.equal(loadConfig({ KEYBOARD_IN_PORT: 'a', KEYBOARD_OUT_PORT: 'b' }).midi.keyboardOut, 'b');
});
