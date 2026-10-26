import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeState, flatten, wordProgress } from './core';
import type { LyricsJson } from './types';

const mk = (lines: [number, number][]): LyricsJson => ({
  version: 1,
  offset: 0,
  sections: [{ type: 'couplet', lines: lines.map(([s, e]) => ({ start: s, end: e, words: [{ t: 'la', start: s, end: e }] })) }],
});

describe('core', () => {
  it('plafonne la durée des mots (silence compté dans le mot par l\'aligneur)', () => {
    const [l] = flatten({ ...mk([[0, 20]]) });
    expect(l.words[0].dur).toBeLessThan(2);
  });

  it('progression du mot', () => {
    const w = { t: 'la', start: 10, dur: 1 };
    expect([wordProgress(w, 9), wordProgress(w, 10.5), wordProgress(w, 12)]).toEqual([0, 0.5, 1]);
  });

  it('attente + compte à rebours avant le début, puis chant', () => {
    const lines = flatten(mk([[20, 21], [22, 23]]));
    expect(computeState(lines, 5)).toMatchObject({ kind: 'wait', next: 0, count: 0 });
    expect(computeState(lines, 17.5)).toMatchObject({ kind: 'wait', next: 0, count: 3 });
    expect(computeState(lines, 19.2)).toMatchObject({ kind: 'wait', next: 0, count: 1 });
    expect(computeState(lines, 20.5)).toEqual({ kind: 'sing', idx: 0 });
    expect(computeState(lines, 22.5)).toEqual({ kind: 'sing', idx: 1 });
  });

  it('silence > 4 s entre deux lignes => attente puis compte à rebours', () => {
    const lines = flatten(mk([[10, 11], [30, 31]]));
    expect(computeState(lines, 11.5)).toMatchObject({ kind: 'sing', idx: 0 }); // maintien 1 s
    expect(computeState(lines, 20)).toMatchObject({ kind: 'wait', next: 1, count: 0 });
    expect(computeState(lines, 28)).toMatchObject({ kind: 'wait', next: 1, count: 2 });
  });

  it('silence court => on enchaîne sans attente', () => {
    const lines = flatten(mk([[10, 11], [13, 14]]));
    expect(computeState(lines, 12.5)).toMatchObject({ kind: 'sing', idx: 0 });
  });

  it('fin de chanson => attente sans prochaine ligne', () => {
    const lines = flatten(mk([[10, 11]]));
    expect(computeState(lines, 60)).toMatchObject({ kind: 'wait', next: -1, count: 0 });
  });

  // Sur les vraies chansons générées par le moteur (si présentes)
  const songs = join(__dirname, '../../../songs');
  const real = existsSync(songs) ? readdirSync(songs).filter((d) => existsSync(join(songs, d, 'lyrics.json'))) : [];
  it.skipIf(!real.length)('parcourt toute une vraie chanson sans incohérence', () => {
    const lyrics: LyricsJson = JSON.parse(readFileSync(join(songs, real[0], 'lyrics.json'), 'utf-8'));
    const lines = flatten(lyrics);
    expect(lines.length).toBeGreaterThan(10);
    let last = -1;
    let waits = 0;
    for (let t = 0; t < 300; t += 0.05) {
      const s = computeState(lines, t);
      if (s.kind === 'sing') {
        expect(s.idx).toBeGreaterThanOrEqual(last); // jamais de retour en arrière
        last = s.idx;
      } else waits++;
    }
    expect(last).toBe(lines.length - 1);
    expect(waits).toBeGreaterThan(0);
  });
});
