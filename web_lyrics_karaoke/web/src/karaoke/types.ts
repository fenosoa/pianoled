/** Format lyrics.json (version 1). Temps en secondes depuis le début de l'audio. */
export type SectionType = 'couplet' | 'refrain' | 'pont' | 'intro' | 'outro';

export interface Word {
  t: string;
  start: number;
  end: number;
  /** confiance de l'aligneur (0..1), facultatif */
  c?: number;
}

export interface Line {
  start: number;
  end: number;
  words: Word[];
}

export interface Section {
  type: SectionType;
  lines: Line[];
}

export interface LyricsJson {
  version: 1;
  /** décalage global : > 0 retarde l'affichage des paroles */
  offset: number;
  sections: Section[];
}
