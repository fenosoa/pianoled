/** Logique pure (sans DOM) du lecteur : aplatissement des lignes, progression des mots, état d'affichage. */
import type { LyricsJson, SectionType, Word } from './types';

export interface FlatWord {
  t: string;
  start: number;
  /** durée de remplissage effective (plafonnée, voir wordFillDuration) */
  dur: number;
}

export interface FlatLine {
  idx: number;
  type: SectionType;
  start: number;
  /** fin effective de chant de la ligne (après plafonnement des mots) */
  end: number;
  words: FlatWord[];
}

export interface CoreOptions {
  /** silence minimal (s) qui déclenche l'attente + compte à rebours */
  gapMin: number;
  /** temps (s) pendant lequel la ligne reste affichée après son dernier mot */
  hold: number;
  /** le compte à rebours démarre N secondes avant la reprise */
  countdown: number;
  /** la ligne suivante s'affiche légèrement avant son début */
  lead: number;
}

/** Les mots se remplissent WORD_LEAD s avant la voix (confort du chanteur) ; la ligne s'affiche encore plus tôt. */
export const WORD_LEAD = 0.3;

export const DEFAULT_CORE: CoreOptions = { gapMin: 4, hold: 1, countdown: 3, lead: 0.4 };

/**
 * L'aligneur fait finir chaque mot au début du suivant : les silences sont comptés dans le mot.
 * On plafonne donc la durée de remplissage selon la longueur du mot (une tenue réelle reste
 * possible jusqu'à ce plafond ; l'éditeur permet de corriger au cas par cas).
 */
export function wordFillDuration(w: Pick<Word, 't' | 'start' | 'end'>): number {
  const raw = Math.max(w.end - w.start, 0.05);
  const cap = 0.6 + 0.25 * w.t.length;
  return Math.min(raw, cap);
}

export function flatten(lyrics: LyricsJson): FlatLine[] {
  const out: FlatLine[] = [];
  for (const s of lyrics.sections) {
    for (const l of s.lines) {
      if (!l.words.length) continue;
      const words = l.words.map((w) => ({ t: w.t, start: w.start, dur: wordFillDuration(w) }));
      const end = Math.max(...words.map((w) => w.start + w.dur));
      out.push({ idx: out.length, type: s.type, start: l.start, end, words });
    }
  }
  out.sort((a, b) => a.start - b.start);
  out.forEach((l, i) => (l.idx = i));
  return out;
}

/** Progression 0..1 du remplissage d'un mot à l'instant t. */
export function wordProgress(w: FlatWord, t: number): number {
  if (t <= w.start) return 0;
  if (t >= w.start + w.dur) return 1;
  return (t - w.start) / w.dur;
}

export type DisplayState =
  /** on chante la ligne `idx` */
  | { kind: 'sing'; idx: number }
  /**
   * silence : `next` = prochaine ligne (-1 si fin), `count` = points 3..1 (0 = pas de compte à rebours),
   * `until` = secondes avant la reprise, `total` = durée totale de la pause (Infinity si fin de chanson)
   */
  | { kind: 'wait'; next: number; count: number; until: number; total: number };

export function computeState(lines: FlatLine[], t: number, o: CoreOptions = DEFAULT_CORE): DisplayState {
  if (!lines.length) return { kind: 'wait', next: -1, count: 0, until: Infinity, total: Infinity };
  // dernière ligne démarrée (avec anticipation)
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].start - o.lead <= t) i = k;
    else break;
  }
  const waitOn = (next: number): DisplayState => {
    const until = next >= 0 ? lines[next].start - t : Infinity;
    const count = until <= o.countdown ? Math.min(3, Math.max(1, Math.ceil(until))) : 0;
    const since = i >= 0 ? lines[i].end + o.hold : 0;
    const total = next >= 0 ? Math.max(lines[next].start - since, 0.001) : Infinity;
    return { kind: 'wait', next, count, until, total };
  };
  if (i < 0) return waitOn(0);
  const next = i + 1 < lines.length ? i + 1 : -1;
  const cur = lines[i];
  const gap = next >= 0 ? lines[next].start - cur.end : Infinity;
  if (gap > o.gapMin && t > cur.end + o.hold) return waitOn(next);
  return { kind: 'sing', idx: i };
}
