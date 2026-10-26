export const simplifyChord = (chord) => {
  if (!chord) return '';
  return chord
    .replace(':', '')
    .replace('maj', '')
    .replace('min', 'm');
};
