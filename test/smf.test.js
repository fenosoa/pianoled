'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSmf, buildTimeline, writeSmf, readVlq, writeVlq, SmfError } = require('../src/midi/smf');

const chunk = (id, bytes) => {
  const b = Buffer.alloc(8 + bytes.length);
  b.write(id, 0, 'latin1');
  b.writeUInt32BE(bytes.length, 4);
  Buffer.from(bytes).copy(b, 8);
  return b;
};
const header = (format, ntracks, division) => {
  const b = Buffer.alloc(6);
  b.writeUInt16BE(format, 0);
  b.writeUInt16BE(ntracks, 2);
  b.writeUInt16BE(division, 4);
  return chunk('MThd', [...b]);
};

test('variable-length quantities round-trip', () => {
  for (const v of [0, 0x40, 0x7f, 0x80, 0x2000, 0x3fff, 0x4000, 0x0fffffff]) {
    assert.deepEqual(readVlq(Buffer.from(writeVlq(v)), 0), [v, writeVlq(v).length]);
  }
});

test('format 0 with running status, meta and sysex events', () => {
  const track = [
    0x00, 0xff, 0x03, 0x02, 0x41, 0x42, // name "AB"
    0x00, 0x90, 60, 100, // note on
    0x00, 64, 90, // running status note on
    0x00, 0xf0, 0x02, 0x7e, 0xf7, // sysex (cancels running status)
    0x83, 0x60, 0x80, 60, 0, // delta 480: note off
    0x00, 0x90, 64, 0, // note on vel 0 = off
    0x00, 0xc0, 5, // program change (1 data byte)
    0x00, 0xff, 0x2f, 0x00,
  ];
  const smf = parseSmf(Buffer.concat([header(0, 1, 480), chunk('MTrk', track)]));
  assert.equal(smf.tracks[0].name, 'AB');
  const tl = buildTimeline(smf);
  assert.deepEqual(tl.map((e) => e.bytes), [[0x90, 60, 100], [0x90, 64, 90], [0x80, 60, 0], [0x90, 64, 0], [0xc0, 5]]);
  assert.equal(tl[2].timeMs, 500); // 480 ticks at default 120 BPM
});

test('tempo map from track 0 applies to other tracks (format 1)', () => {
  const buf = writeSmf({
    division: 480,
    tracks: [
      { events: [{ tick: 0, tempo: 1000000 }, { tick: 480, tempo: 250000 }] },
      { events: [{ tick: 480, bytes: [0x90, 60, 1] }, { tick: 960, bytes: [0x80, 60, 0] }] },
    ],
  });
  const tl = buildTimeline(parseSmf(buf));
  assert.equal(tl[0].timeMs, 1000); // 1 quarter at 60 BPM
  assert.equal(tl[1].timeMs, 1250); // + 1 quarter at 240 BPM
  assert.equal(tl[0].track, 1);
});

test('note-off sorted before note-on at the same tick (retrigger keeps the note on)', () => {
  const buf = writeSmf({
    tracks: [
      { events: [{ tick: 0, bytes: [0x90, 60, 90] }, { tick: 480, bytes: [0x90, 60, 90] }] },
      { events: [{ tick: 480, bytes: [0x80, 60, 0] }, { tick: 960, bytes: [0x80, 60, 0] }] },
    ],
  });
  const tl = buildTimeline(parseSmf(buf));
  assert.deepEqual(tl.map((e) => [e.tick, e.bytes[0] & 0xf0]), [[0, 0x90], [480, 0x80], [480, 0x90], [960, 0x80]]);
});

test('SMPTE division', () => {
  const division = ((256 - 25) << 8) | 40; // 25 fps, 40 ticks/frame -> 1 ms per tick
  const smf = parseSmf(Buffer.concat([header(0, 1, division), chunk('MTrk', [0x00, 0x90, 60, 1, 0x81, 0x48, 0x80, 60, 0, 0, 0xff, 0x2f, 0])]));
  const tl = buildTimeline(smf);
  assert.equal(tl[1].timeMs, 200);
});

test('invalid files are rejected', () => {
  assert.throws(() => parseSmf(Buffer.from('RIFF0000000000')), SmfError);
  assert.throws(() => parseSmf(Buffer.concat([header(0, 1, 480), chunk('MTrk', [0x00, 60, 1])])), /running status/);
  assert.throws(() => parseSmf(Buffer.concat([header(0, 1, 480), chunk('MTrk', [0x00, 0x90, 60])])), /truncated/);
});
