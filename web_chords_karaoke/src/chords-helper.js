const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const tonicPc = (key) => {
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(key ?? '');
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return (NOTE_PC[m[1].toUpperCase()] + acc + 12) % 12;
};

// Capo pour jouer dans la tonalité affichée (ex. G) tout en sonnant dans la tonalité d'origine (ex. G#)
export const capoFor = (originalKey, playedKey) => {
  const o = tonicPc(originalKey);
  const p = tonicPc(playedKey);
  return o == null || p == null ? null : (o - p + 12) % 12;
};

export const simplifyChord = (chord) => {
  if (!chord) return '';
  return chord
    .replace(':', '')
    .replace('maj', '')
    .replace('min', 'm');
};
