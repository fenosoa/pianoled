'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MidiRouter } = require('../src/adapters/router');
const { ManagedPort } = require('../src/adapters/managed-port');
const { makeEngine } = require('./helpers');

class FakeIn extends EventEmitter {}
class FakeOut {
  constructor() {
    this.sent = [];
    this.up = true;
  }
  send(bytes) {
    if (!this.up) return false;
    this.sent.push(bytes);
    return true;
  }
}

function setup(opts = {}) {
  const { engine } = makeEngine({ SYNTH_CHANNEL_COLORS: '1:green,2:blue' });
  const keyboardIn = new FakeIn();
  const synthesiaIn = new FakeIn();
  const synthesiaOut = new FakeOut();
  const router = new MidiRouter({ engine, keyboardIn, synthesiaIn, synthesiaOut, ...opts });
  router.start();
  const sym = (note) => engine.cell(engine.mapper.ledForNote(note))?.symbol || null;
  return { engine, keyboardIn, synthesiaIn, synthesiaOut, router, sym };
}

test('keyboard events are forwarded unchanged to Synthesia and lit white', () => {
  const { keyboardIn, synthesiaOut, sym } = setup();
  keyboardIn.emit('message', [0x90, 60, 77], 1);
  keyboardIn.emit('message', [0xb0, 64, 127], 2);
  keyboardIn.emit('message', [0xe0, 0, 70], 3);
  assert.deepEqual(synthesiaOut.sent, [[0x90, 60, 77], [0xb0, 64, 127], [0xe0, 0, 70]]);
  assert.equal(sym(60), 'W');
});

test('out-of-mapping keyboard notes are still forwarded', () => {
  const { keyboardIn, synthesiaOut, engine } = setup();
  keyboardIn.emit('message', [0x90, 10, 77], 1);
  assert.deepEqual(synthesiaOut.sent, [[0x90, 10, 77]]);
  assert.equal(engine.snapshot().stats.unmapped, 1);
});

test('Synthesia events drive LEDs but are never forwarded (no feedback loop)', () => {
  const { synthesiaIn, synthesiaOut, sym } = setup();
  synthesiaIn.emit('message', [0x91, 62, 90], 1);
  assert.equal(synthesiaOut.sent.length, 0);
  assert.equal(sym(62), 'B');
});

test('both flows simultaneously keep priority', () => {
  const { keyboardIn, synthesiaIn, sym } = setup();
  synthesiaIn.emit('message', [0x90, 60, 90], 1);
  keyboardIn.emit('message', [0x90, 60, 90], 2);
  assert.equal(sym(60), 'W');
  keyboardIn.emit('message', [0x80, 60, 0], 3);
  assert.equal(sym(60), 'G');
});

test('disconnecting one input clears only that source', () => {
  const { keyboardIn, synthesiaIn, sym } = setup();
  keyboardIn.emit('message', [0x90, 60, 90], 1);
  synthesiaIn.emit('message', [0x90, 62, 90], 1);
  synthesiaIn.emit('disconnected', 'x');
  assert.equal(sym(60), 'W');
  assert.equal(sym(62), null);
  synthesiaIn.emit('message', [0x90, 62, 90], 1);
  keyboardIn.emit('disconnected', 'y');
  assert.equal(sym(60), null);
  assert.equal(sym(62), 'G');
});

test('forwarding counts drops when the output is down, LEDs still work', () => {
  const { keyboardIn, synthesiaOut, router, sym } = setup();
  synthesiaOut.up = false;
  keyboardIn.emit('message', [0x90, 60, 90], 1);
  assert.equal(router.stats.forwardDropped, 1);
  assert.equal(sym(60), 'W');
});

test('optional echo guard drops Synthesia echoes of forwarded keyboard notes', () => {
  const { keyboardIn, synthesiaIn, router, sym } = setup({ echoGuardMs: 50 });
  keyboardIn.emit('message', [0x90, 60, 90], 100);
  synthesiaIn.emit('message', [0x90, 60, 90], 120);
  keyboardIn.emit('message', [0x80, 60, 0], 130);
  assert.equal(router.stats.echoDropped, 1);
  assert.equal(sym(60), null);
  synthesiaIn.emit('message', [0x90, 60, 90], 500);
  assert.equal(sym(60), 'G');
});

test('ManagedPort reconnects when the port disappears and comes back', () => {
  const world = { names: ['Keyboard A 20:0'] };
  const opened = [];
  class Dev extends EventEmitter {
    getPortCount() { return world.names.length; }
    getPortName(i) { return world.names[i]; }
    ignoreTypes() {}
    openPort(i) { opened.push(world.names[i]); }
    closePort() {}
  }
  const port = new ManagedPort({ midi: { Input: Dev, Output: Dev }, direction: 'input', match: 'keyboard a', label: 'kbd', pollMs: 60000 });
  const events = [];
  port.on('connected', (n) => events.push(`+${n}`));
  port.on('disconnected', (n) => events.push(`-${n}`));
  port.start();
  world.names = [];
  port.poll();
  world.names = ['Other', 'Keyboard A 24:0'];
  port.poll();
  port.stop();
  assert.deepEqual(events, ['+Keyboard A 20:0', '-Keyboard A 20:0', '+Keyboard A 24:0', '-Keyboard A 24:0']);
  assert.deepEqual(opened, ['Keyboard A 20:0', 'Keyboard A 24:0']);
});
