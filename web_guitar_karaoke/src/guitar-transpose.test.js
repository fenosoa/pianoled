import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeSong, chordDifficulty, normalizeTimeline, parseChord, playedChord, renderForCapo, spellingFor } from './guitar-transpose.js';

const SHARP = spellingFor(null);
const mk = (chords, extra = {}) => ({ key_signature: 'G:maj', original_key: 'G:maj', timeline: chords.map((c, i) => `${(i % 4) + 1};${c};${i * 2};${i * 2 + 2}`).join('\n'), ...extra });

test('parseChord lit le format Chordify', () => {
  assert.deepEqual(parseChord('D:maj/F#'), { root: 2, quality: 'maj', known: true, bass: 6 });
  assert.equal(parseChord('N'), null);
  assert.equal(parseChord('A:min7').quality, 'min7');
  assert.equal(parseChord('Am7').quality, 'min7'); // tolère "Am7" sans ":"
});

test('formes ouvertes faciles, D#m pénible', () => {
  assert.equal(chordDifficulty(parseChord('G:maj')), 0);
  assert.equal(chordDifficulty(parseChord('E:min')), 0);
  assert.ok(chordDifficulty(parseChord('D#:min')) > 1.3);
  assert.ok(chordDifficulty(parseChord('F#:maj')) > chordDifficulty(parseChord('F:maj')));
});

test('déjà jouable : capo 0 conservé', () => {
  const s = analyzeSong(mk(['G:maj', 'D:maj', 'E:min', 'C:maj']));
  assert.equal(s.recommended, 0);
});

test('Adele (A:maj sonnant, timeline en G) → capo 2 et formes en G', () => {
  const s = analyzeSong(mk(['G:maj', 'D:maj', 'E:min', 'C:maj'], { original_key: 'A:maj', transpose_up: 10 }));
  assert.equal(s.soundShift, 2);
  assert.equal(s.recommended, 2);
  const r = renderForCapo(s, 2);
  assert.equal(r.play('E:min').label, 'Em');
  assert.equal(r.play('G:maj').label, 'G');
});

test('le capo manuel simule les notes en direct', () => {
  const s = analyzeSong(mk(['G:maj'], { original_key: 'A:maj', transpose_up: 10 }));
  assert.equal(renderForCapo(s, 0).play('G:maj').label, 'A');
  assert.equal(renderForCapo(s, 4).play('G:maj').label, 'F');
});

test('jamais de D#m si un capo l\'évite (Eb:min sonnant)', () => {
  const s = analyzeSong(mk(['G:maj', 'E:min', 'C:maj', 'D:maj'], { original_key: 'B:maj', key_signature: 'G:maj' }));
  // sonnant B, E→ G#m... formes sans capo : B, G#m, E, F# (barrés) → un capo doit être préféré
  assert.ok(s.recommended > 0);
  const r = renderForCapo(s, s.recommended);
  for (const c of ['G:maj', 'E:min', 'C:maj', 'D:maj']) assert.ok(r.play(c).cost <= 1.3, `${c} → ${r.play(c).label}`);
});

test('orthographe : Bb en tonalité de F, F# en tonalité de D', () => {
  assert.equal(playedChord('A#:maj', 0, 0, spellingFor(5, false)).label, 'Bb');
  assert.equal(playedChord('F#:min', 0, 0, spellingFor(2, false)).label, 'F#m');
});

test('chansons réelles du serveur (si présentes) : le capo reste raisonnable', () => {
  const dir = path.resolve(import.meta.dirname, '../../web_chords_karaoke/piano_stems_output');
  if (!fs.existsSync(dir)) return;
  const dist = {};
  for (const name of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const file = fs.readdirSync(path.join(dir, name.name)).find((f) => f.endsWith('.chords.json'));
    if (!file) continue;
    const s = analyzeSong(normalizeTimeline(JSON.parse(fs.readFileSync(path.join(dir, name.name, file), 'utf8'))));
    dist[s.recommended] = (dist[s.recommended] ?? 0) + 1;
    assert.ok(s.recommended <= 7);
  }
  console.log('répartition des capos recommandés :', dist);
});
