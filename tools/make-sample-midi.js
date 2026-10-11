#!/usr/bin/env node
'use strict';

// Generates samples/demo-two-hands.mid: ch1 melody, ch2 chords, shared notes, tempo change, fast run.
const fs = require('node:fs');
const path = require('node:path');
const { writeSmf } = require('../src/midi/smf');

const Q = 480;
const right = [];
const left = [];
const note = (list, ch, n, start, len, vel = 90) => {
  list.push({ tick: start, bytes: [0x90 | ch, n, vel] });
  list.push({ tick: start + len, bytes: [0x80 | ch, n, 0] });
};

// Bars 1-4: C major scale up/down in eighths (right), chords in whole notes (left).
const scale = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60];
scale.forEach((n, i) => note(right, 0, n, i * (Q / 2), Q / 2 - 10));
[[48, 52, 55], [53, 57, 60], [55, 59, 62], [48, 52, 55, 60]].forEach((chord, bar) =>
  chord.forEach((n) => note(left, 1, n, bar * 4 * Q, 4 * Q - 20, 70))
);
// Bar 5: sustain pedal while the right hand plays an arpeggio.
let t = 16 * Q;
right.push({ tick: t, bytes: [0xb0, 64, 127] });
[60, 64, 67, 72, 76, 79, 84].forEach((n, i) => note(right, 0, n, t + i * (Q / 2), Q / 4));
right.push({ tick: t + 4 * Q - 10, bytes: [0xb0, 64, 0] });
// Bars 6-7 at a faster tempo: chromatic sixteenths over the whole mapped range (A0..E7).
t = 20 * Q;
for (let n = 21, i = 0; n <= 100; n++, i++) note(right, 0, n, t + i * (Q / 4), Q / 4 - 5, 80);
note(left, 1, 36, t, 8 * Q, 60);

const tempo = [{ tick: 0, tempo: 500000 }, { tick: 20 * Q, tempo: 375000 }];
const buf = writeSmf({
  division: Q,
  tracks: [
    { name: 'Tempo', events: tempo },
    { name: 'Right hand (ch1)', events: right },
    { name: 'Left hand (ch2)', events: left },
  ],
});
const out = path.resolve(__dirname, '..', 'samples', 'demo-two-hands.mid');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
