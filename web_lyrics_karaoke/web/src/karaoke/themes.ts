import type { SectionType } from './types';

export interface Palette {
  /** 3 couleurs du dégradé de fond animé */
  bg: [string, string, string];
  /** couleur de remplissage des mots chantés */
  fill: string;
}

export interface Theme {
  palettes: Record<SectionType, Palette>;
  /** couleur du texte pas encore chanté */
  base: string;
  /** contour du texte (lisibilité sur tout fond) */
  outline: string;
  fontFamily: string;
}

export const DEFAULT_THEME: Theme = {
  palettes: {
    couplet: { bg: ['#1e3a8a', '#6d28d9', '#0891b2'], fill: '#fde047' },
    refrain: { bg: ['#9d174d', '#ea580c', '#f59e0b'], fill: '#22d3ee' },
    pont: { bg: ['#064e3b', '#0f766e', '#65a30d'], fill: '#f9a8d4' },
    intro: { bg: ['#111827', '#312e81', '#0e7490'], fill: '#a7f3d0' },
    outro: { bg: ['#111827', '#4c1d95', '#be185d'], fill: '#a7f3d0' },
  },
  base: '#ffffff',
  outline: '#1a1030',
  fontFamily: '"Baloo 2", "Fredoka", "Trebuchet MS", system-ui, sans-serif',
};

export function mergeTheme(base: Theme, over: Partial<Theme>): Theme {
  return { ...base, ...over, palettes: { ...base.palettes, ...(over.palettes ?? {}) } };
}
