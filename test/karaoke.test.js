'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChord } = require('../src/karaoke/chord-parser');
const { normalizeKaraokeConfig } = require('../src/karaoke/config');
const { KaraokeController, renderChordFrame } = require('../src/karaoke/controller');
const { KaraokeSocket } = require('../src/karaoke/ws-client');
const { RippleEffect } = require('../src/karaoke/ripple');
const { makeEngine } = require('./helpers');
const { noteOn } = require('../src/midi/messages');
const { silentLogger } = require('../src/logger');

const pcs = (name) => parseChord(name)?.pcs;

test('parser: triads, sharps/flats, both notations', () => {
  assert.deepEqual(pcs('C'), [0, 4, 7]);
  assert.deepEqual(pcs('Em'), [4, 7, 11]);
  assert.deepEqual(pcs('E:min'), [4, 7, 11]);
  assert.deepEqual(pcs('G:maj'), [2, 7, 11]);
  assert.deepEqual(pcs('F#m'), [1, 6, 9]);
  assert.deepEqual(pcs('Db'), [1, 5, 8]);
  assert.deepEqual(pcs('C#'), pcs('Db'));
  assert.equal(parseChord('Bb').root, 10);
});

test('parser: sevenths and extensions', () => {
  assert.deepEqual(pcs('G7'), [2, 5, 7, 11]);
  assert.deepEqual(pcs('A:7'), [1, 4, 7, 9]);
  assert.deepEqual(pcs('Cmaj7'), [0, 4, 7, 11]);
  assert.deepEqual(pcs('C:maj7'), [0, 4, 7, 11]);
  assert.deepEqual(pcs('D:min7'), [0, 2, 5, 9]);
  assert.deepEqual(pcs('Am7'), [0, 4, 7, 9]);
  assert.deepEqual(pcs('Cdim'), [0, 3, 6]);
  assert.deepEqual(pcs('Caug'), [0, 4, 8]);
  assert.deepEqual(pcs('Csus2'), [0, 2, 7]);
  assert.deepEqual(pcs('Csus4'), [0, 5, 7]);
  assert.deepEqual(pcs('C6'), [0, 4, 7, 9]);
  assert.deepEqual(pcs('Cm6'), [0, 3, 7, 9]);
});

test('parser: 9 and above simplify to the 7th chord', () => {
  assert.deepEqual(pcs('C9'), pcs('C7'));
  assert.deepEqual(pcs('Am9'), pcs('Am7'));
  assert.deepEqual(pcs('Cmaj9'), pcs('Cmaj7'));
  assert.deepEqual(pcs('C13'), pcs('C7'));
});

test('parser: bass is added to the set and exposed', () => {
  const g = parseChord('G/B');
  assert.deepEqual(g.pcs, [2, 7, 11]);
  assert.equal(g.bass, 11);
  const d = parseChord('D/F#');
  assert.equal(d.bass, 6);
  assert.deepEqual(d.pcs, [2, 6, 9]);
  assert.equal(parseChord('C/E').bass, 4);
  assert.equal(parseChord('E:min/b3').bass, 7); // Chordify interval bass
  assert.deepEqual(parseChord('C/D').pcs, [0, 2, 4, 7]);
});

test('parser: empty, N.C. and garbage give null, never throw', () => {
  for (const v of ['', '  ', 'N.C.', 'N', 'NC', 'X', null, undefined, 42, 'H', 'Cxyz', '???']) assert.equal(parseChord(v), null, String(v));
});

test('renderChordFrame lights every octave of the chord notes only; bass red on the left half only', () => {
  const { engine } = makeEngine();
  const cfg = normalizeKaraokeConfig({ brightness: { karaoke: 1 }, chordColors: { Em: '#0000ff' } });
  const em = renderChordFrame(parseChord('Em'), engine.mapper, cfg);
  for (let n = 0; n <= 127; n++) {
    const led = engine.mapper.ledForNote(n);
    if (led === null) continue;
    assert.equal(!!em.cells[led], [4, 7, 11].includes(n % 12), `note ${n}`);
  }
  const e4 = engine.mapper.ledForNote(64) * 3;
  assert.deepEqual([...em.pixels.subarray(e4, e4 + 3)], [0, 0, 255]);

  const d = renderChordFrame(parseChord('D/F#'), engine.mapper, cfg);
  assert.equal(d.cells[engine.mapper.ledForNote(30)].symbol, 'R'); // F#1, left half
  assert.equal(d.cells[engine.mapper.ledForNote(102)].symbol, 'K'); // F#7, right half
  assert.equal(d.cells[engine.mapper.ledForNote(62)].symbol, 'K'); // D keeps the chord color
});

function setup(overrides = {}) {
  const { engine } = makeEngine();
  const cfg = normalizeKaraokeConfig({ fadeMs: 0, pauseTimeoutS: 0, brightness: { karaoke: 1 }, ripple: { enabled: false }, ...overrides });
  const ctl = new KaraokeController({ engine, config: cfg, logger: silentLogger });
  const lit = () => engine.frame.cells.filter(Boolean).length;
  return { engine, ctl, lit };
}

test('controller: IDLE by default, MIDI lights; KARAOKE ignores MIDI; idle returns to IDLE', () => {
  const { engine, ctl, lit } = setup();
  engine.handle(noteOn('keyboard', 60));
  assert.equal(ctl.mode, 'IDLE');
  assert.equal(lit(), 1);

  ctl.handleMessage('{"type":"song"}');
  assert.equal(ctl.mode, 'KARAOKE');
  assert.equal(lit(), 0);
  ctl.handleMessage('{"type":"chord","chord":"C"}');
  const chordLeds = lit();
  assert.ok(chordLeds > 3);
  engine.handle(noteOn('keyboard', 61)); // ignored for lighting
  assert.equal(lit(), chordLeds);

  ctl.handleMessage('{"type":"idle"}');
  assert.equal(ctl.mode, 'IDLE');
  assert.equal(lit(), 2); // held keys 60 and 61 show again
  ctl.stop();
});

test('controller: bad JSON and foreign messages are ignored; N.C. turns off or holds', () => {
  const { ctl, lit } = setup();
  ctl.handleMessage('not json');
  ctl.handleMessage('{"type":"state","playing":true}');
  assert.equal(ctl.mode, 'IDLE');
  ctl.handleMessage('{"type":"chord","chord":"G"}');
  assert.equal(ctl.mode, 'KARAOKE');
  assert.ok(lit() > 0);
  ctl.handleMessage('{"type":"chord","chord":"N.C."}');
  assert.equal(lit(), 0);
  ctl.stop();

  const held = setup({ onNoChord: 'hold' });
  held.ctl.handleMessage('{"type":"chord","chord":"G"}');
  const n = held.lit();
  held.ctl.handleMessage('{"type":"chord","chord":"???"}');
  assert.equal(held.lit(), n);
  held.ctl.stop();
});

test('controller: disconnect and chord timeout go back to IDLE', async () => {
  const { ctl } = setup();
  ctl.handleMessage('{"type":"chord","chord":"C"}');
  ctl.onDisconnect();
  assert.equal(ctl.mode, 'IDLE');

  const t = setup({ pauseTimeoutS: 0.05 });
  t.ctl.handleMessage('{"type":"chord","chord":"C"}');
  assert.equal(t.ctl.mode, 'KARAOKE');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(t.ctl.mode, 'IDLE');
  t.ctl.stop();
});

test('controller: fade reaches the target frame', async () => {
  const { engine, ctl } = setup({ fadeMs: 60 });
  ctl.handleMessage('{"type":"chord","chord":"C"}');
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(engine.frame.pixels.equals(renderChordFrame(parseChord('C'), engine.mapper, ctl.cfg).pixels));
  ctl.stop();
});

test('socket: reconnects with backoff and reports connect/disconnect', async () => {
  const sockets = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(d) {
      this.sent.push(d);
    }
    close() {}
  }
  const events = [];
  const client = new KaraokeSocket({
    url: 'ws://x',
    logger: silentLogger,
    WebSocketImpl: FakeWS,
    backoffMs: [10, 20],
    connectTimeoutMs: 1000,
    onMessage: (m) => events.push(`msg:${m}`),
    onConnect: () => events.push('up'),
    onDisconnect: () => events.push('down'),
  });
  client.start();
  sockets[0].onclose(); // server not there yet
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.deepEqual(JSON.parse(sockets[1].sent[0]), { type: 'hello', role: 'follower' });
  sockets[1].onmessage({ data: '{"type":"idle"}' });
  sockets[1].onclose();
  assert.deepEqual(events, ['up', 'msg:{"type":"idle"}', 'down']);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sockets.length, 3);
  client.stop();
});

test('controller: forced synthesia ignores player messages until a manual idle', () => {
  const { engine, ctl, lit } = setup();
  ctl.handleMessage('{"type":"chord","chord":"C"}');
  assert.equal(ctl.mode, 'KARAOKE');
  ctl.handleMessage('{"type":"synthesia"}');
  assert.equal(ctl.mode, 'SYNTHESIA');
  engine.handle(noteOn('keyboard', 60));
  assert.equal(lit(), 1);
  for (const m of ['{"type":"song"}', '{"type":"chord","chord":"G"}', '{"type":"idle"}']) {
    ctl.handleMessage(m);
    assert.equal(ctl.mode, 'SYNTHESIA', m);
  }
  assert.equal(lit(), 1);
  ctl.handleMessage('{"type":"idle","manual":true}');
  assert.equal(ctl.mode, 'IDLE');
  ctl.handleMessage('{"type":"chord","chord":"G"}');
  assert.equal(ctl.mode, 'KARAOKE');
  ctl.stop();
});

const rippleSetup = () => setup({ ripple: { enabled: true, brightness: 0.5, speed: 30, wavelength: 24, fps: 60 } });
const litLeds = (engine) => {
  const out = [];
  for (let i = 0; i < 120; i++) if (engine.frame.pixels.subarray(i * 3, i * 3 + 3).some(Boolean)) out.push(i);
  return out;
};

test('ripple: IDLE and KARAOKE show a wave on every LED, SYNTHESIA does not', async () => {
  const { engine, ctl } = rippleSetup();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(litLeds(engine).length, 120); // IDLE wave
  ctl.handleMessage('{"type":"chord","chord":"C"}');
  assert.equal(ctl.mode, 'KARAOKE');
  assert.equal(litLeds(engine).length, 120); // KARAOKE wave under the chord
  const c = engine.mapper.ledForNote(60);
  assert.deepEqual([...engine.frame.pixels.subarray(c * 3, c * 3 + 3)], [...renderChordFrame(parseChord('C'), engine.mapper, ctl.cfg).pixels.subarray(c * 3, c * 3 + 3)]);
  ctl.handleMessage('{"type":"synthesia"}');
  assert.equal(litLeds(engine).length, 0);
  assert.equal(engine.background, null);
  ctl.handleMessage('{"type":"idle","manual":true}');
  assert.equal(litLeds(engine).length, 120);
  ctl.stop();
});

test('ripple: wave moves left to right; played keys launch a ring only in IDLE', () => {
  const { engine, ctl } = rippleSetup();
  let t = 1000;
  const ripple = new RippleEffect({ mapper: engine.mapper, config: ctl.cfg.ripple, now: () => t });
  const px = (i) => [...ripple.pixels.subarray(i * 3, i * 3 + 3)];
  ripple.tick(t);
  const before = px(40);
  t += 200;
  ripple.tick(t);
  const shift = ctl.cfg.ripple.speed * 0.2; // LEDs travelled in 200 ms (tick caps dt at 250 ms)
  assert.deepEqual(px(40 + shift), before); // what was at LED 40 is now `shift` LEDs to the right

  const plain = Buffer.from(ripple.pixels);
  ripple.noteOn(60, 100);
  ripple.tick(t); // same instant: only the ring differs
  assert.ok(!plain.equals(ripple.pixels), 'ring lights the frame');
  ripple.setReactive(false); // KARAOKE
  ripple.noteOn(62, 100);
  assert.equal(ripple.pulses.length, 0);

  engine.handle(noteOn('keyboard', 60)); // IDLE controller feeds its own effect
  assert.equal(ctl.ripple.pulses.length, 1);
  ctl.handleMessage('{"type":"song"}');
  engine.handle(noteOn('keyboard', 62));
  assert.equal(ctl.ripple.pulses.length, 0);
  ctl.stop();
});
