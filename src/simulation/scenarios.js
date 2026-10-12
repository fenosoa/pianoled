'use strict';

const { noteOn, noteOff, controlChange, parseMessage, CC, noteName } = require('../midi/messages');
const { mappedNotes } = require('../mapping/note-map');
const { monotonicMs } = require('../metrics');

/**
 * Builds the helper context used by scenarios. Every scenario checks the expected LED colors
 * itself, so the same scripts validate the logic in dry-run and drive the real strip.
 */
function createContext(engine, { holdMs = 400, print = console.log, quiet = false } = {}) {
  const notes = mappedNotes(engine.mapper);
  if (notes.length === 0) throw new Error('mapping maps no note to any LED');
  const results = { pass: 0, fail: 0, failures: [] };
  const ts = () => monotonicMs();

  const ctx = {
    engine,
    notes,
    holdMs,
    results,
    mid: notes[Math.floor(notes.length / 2)],
    kbOn: (n, vel = 100, ch = 0) => engine.handle(noteOn('keyboard', n, vel, ch, ts())),
    kbOff: (n, ch = 0) => engine.handle(noteOff('keyboard', n, 0, ch, ts())),
    syOn: (n, ch = 0, vel = 100) => engine.handle(noteOn('synthesia', n, vel, ch, ts())),
    syOff: (n, ch = 0) => engine.handle(noteOff('synthesia', n, 0, ch, ts())),
    cc: (source, controller, value, ch = 0) => engine.handle(controlChange(source, controller, value, ch, ts())),
    wait: (ms = holdMs) => new Promise((r) => setTimeout(r, ms)),
    show: (label) => {
      if (!quiet) print(`  ${engine.ledString()}  ${label}`);
    },
    synthSymbol: (ch) => engine.palette.synthForChannel(ch).symbol,
    expect: (note, symbol, label) => {
      const led = engine.mapper.ledForNote(note);
      const got = led === null ? null : engine.cell(led)?.symbol || null;
      const ok = got === symbol;
      if (ok) results.pass++;
      else {
        results.fail++;
        results.failures.push(`${label}: note ${note} expected ${symbol || 'off'} got ${got || 'off'}`);
      }
      if (!quiet) print(`    ${ok ? 'PASS' : 'FAIL'} ${label} (note ${note} ${noteName(note)} led ${led}) -> ${got || 'off'}`);
      return ok;
    },
    expectAllOff: (label) => {
      const ok = !/[^.]/.test(engine.ledString());
      if (ok) results.pass++;
      else {
        results.fail++;
        results.failures.push(`${label}: expected all LEDs off`);
      }
      if (!quiet) print(`    ${ok ? 'PASS' : 'FAIL'} ${label}`);
      return ok;
    },
  };
  return ctx;
}

const scenarios = {
  async single(c) {
    const n = c.mid;
    c.kbOn(n);
    c.show(`keyboard noteon ${noteName(n)}`);
    c.expect(n, 'W', 'keyboard note is white');
    await c.wait();
    c.kbOff(n);
    c.show(`keyboard noteoff ${noteName(n)}`);
    c.expect(n, null, 'keyboard release turns off');
    await c.wait(150);
    c.syOn(n + 2, 0);
    c.show(`synthesia noteon ${noteName(n + 2)} ch1`);
    c.expect(n + 2, c.synthSymbol(0), 'synthesia ch1 color');
    await c.wait();
    c.syOff(n + 2, 0);
    c.show('synthesia noteoff');
    c.expect(n + 2, null, 'synthesia release turns off');
  },

  async chord(c) {
    const k = [c.mid, c.mid + 4, c.mid + 7];
    const s = [c.mid - 12, c.mid - 8, c.mid - 5];
    k.forEach((n) => c.kbOn(n));
    s.forEach((n, i) => c.syOn(n, i % 2));
    c.show('keyboard C-E-G + synthesia chord on ch1/ch2');
    k.forEach((n) => c.expect(n, 'W', 'keyboard chord white'));
    s.forEach((n, i) => c.expect(n, c.synthSymbol(i % 2), `synthesia chord ch${(i % 2) + 1}`));
    await c.wait(c.holdMs * 2);
    c.kbOff(k[1]);
    c.show('release middle keyboard note only');
    c.expect(k[1], null, 'released note off');
    c.expect(k[0], 'W', 'other keyboard notes still on');
    c.expect(s[1], c.synthSymbol(1), 'synthesia untouched');
    await c.wait();
    k.forEach((n) => c.kbOff(n));
    s.forEach((n, i) => c.syOff(n, i % 2));
    c.show('all released');
    c.expectAllOff('chord fully released');
  },

  async overlap(c) {
    const n = c.mid;
    for (const ch of [0, 1]) {
      const sym = c.synthSymbol(ch);
      c.syOn(n, ch);
      c.show(`synthesia ch${ch + 1} on`);
      c.expect(n, sym, `synthesia ch${ch + 1} color`);
      await c.wait();
      c.kbOn(n);
      c.show('keyboard on same note');
      c.expect(n, 'O', 'overlap color while both hold the note');
      await c.wait();
      c.kbOff(n);
      c.show('keyboard off, synthesia still held');
      c.expect(n, sym, 'synthesia color restored');
      await c.wait();
      c.syOff(n, ch);
      c.show('synthesia off');
      c.expect(n, null, 'note off');
      await c.wait(150);
    }
    // Reverse order: keyboard first, synthesia released while keyboard held.
    c.kbOn(n);
    c.syOn(n, 0);
    c.show('keyboard held, synthesia on underneath');
    c.expect(n, 'O', 'overlap color');
    c.syOff(n, 0);
    c.expect(n, 'W', 'synthesia release does not clear keyboard');
    c.kbOff(n);
    c.expect(n, null, 'final off');
  },

  async scale(c) {
    const step = Math.max(15, Math.round(c.holdMs / 8));
    for (const n of c.notes) {
      c.kbOn(n);
      await c.wait(step);
      c.kbOff(n);
    }
    c.show('keyboard chromatic scale up');
    for (const n of [...c.notes].reverse()) {
      c.syOn(n, n % 2);
      await c.wait(step);
      c.syOff(n, n % 2);
    }
    c.show('synthesia chromatic scale down (ch1/ch2 alternate)');
    c.expectAllOff('scale ends dark');
  },

  async fast(c) {
    const { engine } = c;
    engine.scheduler.resetMetrics();
    const before = engine.stats.events;
    const held = { keyboard: new Set(), synthesia: new Set() };
    let seed = 12345;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >>> 16) % n;
    };
    const total = 3000;
    const t0 = monotonicMs();
    for (let i = 0; i < total; i++) {
      const source = rnd(2) ? 'keyboard' : 'synthesia';
      const n = c.notes[rnd(c.notes.length)];
      const set = held[source];
      if (set.has(n)) {
        source === 'keyboard' ? c.kbOff(n) : c.syOff(n, 0);
        set.delete(n);
      } else {
        source === 'keyboard' ? c.kbOn(n, 1 + rnd(126)) : c.syOn(n, 0, 1 + rnd(126));
        set.add(n);
      }
      if (i % 4 === 3) await c.wait(2);
    }
    const genMs = monotonicMs() - t0;
    c.show(`after ${total} random events (${(total / (genMs / 1000)).toFixed(0)} ev/s)`);
    for (const n of held.keyboard) c.expect(n, held.synthesia.has(n) ? 'O' : 'W', 'held keyboard note still lit');
    for (const n of held.synthesia) if (!held.keyboard.has(n)) c.expect(n, c.synthSymbol(0), 'held synthesia note colored');
    for (const n of held.keyboard) c.kbOff(n);
    for (const n of held.synthesia) c.syOff(n, 0);
    await c.wait(50);
    c.expectAllOff('fast sequence released cleanly');
    c.fastReport = { events: engine.stats.events - before, genMs };
  },

  async edge(c) {
    const n = c.mid;
    const unmapped = [];
    for (let x = 0; x <= 127; x++) if (c.engine.mapper.ledForNote(x) === null) unmapped.push(x);
    if (unmapped.length) {
      const before = c.engine.ledString();
      c.kbOn(unmapped[0]);
      c.syOn(unmapped[unmapped.length - 1], 0);
      const ok = c.engine.ledString() === before;
      c.results[ok ? 'pass' : 'fail']++;
      if (!ok) c.results.failures.push('unmapped notes changed the frame');
      c.show(`unmapped notes ${unmapped[0]} / ${unmapped[unmapped.length - 1]} ignored: ${ok ? 'PASS' : 'FAIL'}`);
      c.kbOff(unmapped[0]);
      c.syOff(unmapped[unmapped.length - 1], 0);
    }

    c.kbOn(n);
    c.engine.handle(parseMessage([0x90, n, 0], 'keyboard', monotonicMs()));
    c.show('Note On velocity 0');
    c.expect(n, null, 'velocity 0 acts as note off');

    c.kbOn(n);
    c.kbOn(n);
    c.kbOn(n);
    c.kbOff(n);
    c.show('3x noteon then 1x noteoff');
    c.expect(n, null, 'repeated noteon released by one noteoff');

    c.kbOff(n + 1);
    c.show('noteoff without noteon');
    c.expect(n + 1, null, 'orphan noteoff harmless');

    c.cc('keyboard', CC.SUSTAIN, 127);
    c.kbOn(n);
    c.kbOff(n);
    c.show(`sustain down, key released (SUSTAIN_MODE=${c.engine.config.sustainMode})`);
    c.expect(n, c.engine.config.sustainMode === 'sound' ? 'W' : null, 'sustain policy applied');
    c.cc('keyboard', CC.SUSTAIN, 0);
    c.expect(n, null, 'sustain release clears');

    c.kbOn(n);
    c.syOn(n + 2, 0);
    c.syOn(n + 3, 1);
    c.cc('synthesia', CC.ALL_NOTES_OFF, 0, 0);
    c.show('All Notes Off on synthesia ch1');
    c.expect(n + 2, null, 'synthesia ch1 cleared');
    c.expect(n + 3, c.synthSymbol(1), 'synthesia ch2 kept');
    c.expect(n, 'W', 'keyboard kept');
    c.cc('synthesia', CC.ALL_SOUND_OFF, 0, 1);
    c.expect(n + 3, null, 'All Sound Off ch2 cleared');
    c.cc('keyboard', CC.ALL_NOTES_OFF, 0, 0);
    c.expectAllOff('everything off after All Notes Off');
  },

  async panic(c) {
    c.notes.filter((_, i) => i % 3 === 0).forEach((n) => c.kbOn(n));
    c.notes.filter((_, i) => i % 3 === 1).forEach((n) => c.syOn(n, 0));
    c.show('many notes from both sources');
    await c.wait();
    c.engine.panic('synthesia');
    c.show('panic(synthesia)');
    c.expect(c.notes[0], 'W', 'keyboard survives synthesia panic');
    c.expect(c.notes[1], null, 'synthesia cleared');
    await c.wait();
    c.engine.panic();
    c.show('panic(all)');
    c.expectAllOff('panic clears everything');
  },

  async sweep(c) {
    // Calibration aid: lights each mapped note in turn and prints note -> LED index.
    for (const n of c.notes) {
      c.kbOn(n);
      if (n % 12 === 0) c.show(`note ${n} (${noteName(n)}) -> led ${c.engine.mapper.ledForNote(n)}`);
      await c.wait(Math.max(20, Math.round(c.holdMs / 4)));
      c.kbOff(n);
    }
    c.expectAllOff('sweep ends dark');
  },
};

scenarios.all = async (c) => {
  for (const name of ['single', 'chord', 'overlap', 'edge', 'panic', 'fast']) {
    console.log(`\n== ${name}`);
    await scenarios[name](c);
    await c.wait(100);
  }
};

module.exports = { scenarios, createContext };
