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
  /** vidéo en boucle (fond noir, mélangée en « screen ») par type de section ; absente = dégradé seul */
  fx: Partial<Record<SectionType, string>>;
}

export const DEFAULT_THEME: Theme = {
  palettes: {
    couplet: { bg: ['#3b1d0a', '#7c2d12', '#b45309'], fill: '#40E6D0' },
    refrain: { bg: ['#5c1a0b', '#c2410c', '#f59e0b'], fill: '#40E6D0' },
    pont: { bg: ['#3a1a05', '#92400e', '#ca8a04'], fill: '#40E6D0' },
    intro: { bg: ['#1c0f05', '#4a2511', '#8a5a1c'], fill: '#40E6D0' },
    outro: { bg: ['#1a0c06', '#5c1f12', '#a16207'], fill: '#40E6D0' },
  },
  base: '#FFFDF7',
  outline: '#142536',
  fontFamily: '"Baloo 2", "Fredoka", "Trebuchet MS", system-ui, sans-serif',
  fx: {
    couplet: '/fx/gold-shimmer.mp4',
    refrain: '/fx/gold-glitter.mp4',
    pont: '/fx/gold-falling.mp4',
    intro: '/fx/gold-dust.mp4',
    outro: '/fx/gold-dust.mp4',
  },
};

export function mergeTheme(base: Theme, over: Partial<Theme>): Theme {
  return { ...base, ...over, palettes: { ...base.palettes, ...(over.palettes ?? {}) }, fx: { ...base.fx, ...(over.fx ?? {}) } };
}
