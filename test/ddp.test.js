'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeDdpPacket, decodeDdpHeader, nextSequence } = require('../src/ddp/packet');
const { FrameScheduler } = require('../src/ddp/frame-scheduler');
const { MemoryTransport, UdpTransport } = require('../src/ddp/transport');

test('DDP header matches the validated test-ddp.js layout for 120 LEDs', () => {
  const pixels = Buffer.alloc(360, 7);
  const p = encodeDdpPacket(pixels, 5);
  assert.equal(p.length, 370);
  assert.deepEqual([...p.subarray(0, 10)], [0x41, 0x05, 0x0b, 0x01, 0, 0, 0, 0, 0x01, 0x68]);
  const h = decodeDdpHeader(p);
  assert.equal(h.version, 1);
  assert.equal(h.push, true);
  assert.equal(h.length, 360);
  assert.equal(p[10], 7);
});

test('DDP encoder rejects any frame that is not exactly 360 bytes', () => {
  assert.throws(() => encodeDdpPacket(Buffer.alloc(239), 1), RangeError);
  assert.throws(() => encodeDdpPacket(Buffer.alloc(798 * 3), 1), RangeError);
  assert.throws(() => encodeDdpPacket(Buffer.alloc(360), 16), RangeError);
});

test('sequence cycles 1..15, skipping reserved 0', () => {
  let s = 0;
  const seen = [];
  for (let i = 0; i < 16; i++) seen.push((s = nextSequence(s)));
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 1]);
});

test('scheduler coalesces changes in the same tick into one frame and stops with black frames', async () => {
  const transport = new MemoryTransport();
  let frame = Buffer.alloc(360);
  const sch = new FrameScheduler({ transport, getFrame: () => frame, keepalive: 'off', minFrameGapMs: 0 });
  sch.start();
  assert.equal(transport.packets.length, 1);
  frame = Buffer.alloc(360, 1);
  sch.markDirty();
  sch.markDirty();
  sch.markDirty();
  await new Promise((r) => setImmediate(r));
  assert.equal(transport.packets.length, 2);
  assert.equal(transport.packets[1][10], 1);
  assert.equal(sch.metrics().counters.coalescedChanges, 2);
  await sch.stop({ blackFrames: 2, gapMs: 0 });
  assert.equal(transport.packets.length, 4);
  assert.ok(transport.packets.slice(2).every((p) => p.subarray(10).every((b) => b === 0)));
  assert.equal(transport.closed, true);
});

test('scheduler keepalive resends the current frame at the configured rate', async () => {
  const transport = new MemoryTransport();
  const sch = new FrameScheduler({ transport, getFrame: () => Buffer.alloc(360), fps: 100, keepalive: 'always' });
  sch.start();
  await new Promise((r) => setTimeout(r, 120));
  await sch.stop({ blackFrames: 1 });
  assert.ok(sch.metrics().counters.keepalive >= 3, `keepalive=${sch.metrics().counters.keepalive}`);
});

test('scheduler "active" keepalive goes quiet when idle and dark', async () => {
  const transport = new MemoryTransport();
  const sch = new FrameScheduler({
    transport, getFrame: () => Buffer.alloc(360), fps: 100, keepalive: 'active', idleKeepaliveMs: 0, isActive: () => false,
  });
  sch.start();
  await new Promise((r) => setTimeout(r, 80));
  await sch.stop({ blackFrames: 1 });
  assert.equal(sch.metrics().counters.keepalive, 0);
});

test('dry-run transport never opens a socket', async () => {
  let created = 0;
  const t = new UdpTransport({ host: '192.0.2.1', port: 4048, dryRun: true, createSocket: () => { created++; } });
  await t.send(Buffer.alloc(250));
  await t.close();
  assert.equal(created, 0);
  assert.equal(t.stats.packets, 1);
});

test('UDP transport sends the full packet to host:port (loopback)', async () => {
  const dgram = require('node:dgram');
  const server = dgram.createSocket('udp4');
  await new Promise((r) => server.bind(0, '127.0.0.1', r));
  const received = new Promise((r) => server.once('message', r));
  const t = new UdpTransport({ host: '127.0.0.1', port: server.address().port });
  const packet = encodeDdpPacket(Buffer.alloc(360, 9), 1);
  assert.equal(await t.send(packet), null);
  const msg = await received;
  assert.deepEqual(msg, packet);
  await t.close();
  server.close();
});

test('minimum frame gap is respected without Windows timer rounding (spin mode)', async () => {
  const transport = new MemoryTransport();
  const sch = new FrameScheduler({ transport, getFrame: () => Buffer.alloc(360), keepalive: 'off', minFrameGapMs: 5, spinShortWaits: true });
  sch.start();
  sch.markDirty();
  await new Promise((r) => setTimeout(r, 40));
  const m = sch.metrics();
  await sch.stop({ blackFrames: 1 });
  assert.equal(m.counters.change, 1);
  assert.ok(m.intervalMs.min >= 5, `interval ${m.intervalMs.min}`);
  assert.ok(m.waitMs.max < 10, `wait ${m.waitMs.max}`);
});
