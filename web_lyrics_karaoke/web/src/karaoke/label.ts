/** Nettoie un titre pour l'affichage : retire « (Official Video) », « [HD Remaster] », « | Lyrics », « Clip officiel »… (les fichiers ne changent pas). */
const NOISE = /^(official|officiel|officielle|video|videos|vid[eé]o|audio|clip|lyric|lyrics|music|song|full|hd|4k|remaster|remastered|remasteris[eé]e?|version|live)$/i;
const NOISE_ANY = /(official|officiel|video|vid[eé]o|audio|clip|lyric|\bhd\b|4k|remaster)/i;

export function cleanLabel(raw: string | null | undefined): string {
  let s = String(raw ?? '');
  s = s.split(/\s\|\s/)[0];
  s = s.replace(/\s*[([][^)\]]*[)\]]/g, (g) => (NOISE_ANY.test(g) ? '' : g));
  const words = s.trim().split(/\s+/);
  const isNoise = (w: string) => /^[-–—:_|/]+$/.test(w) || NOISE.test(w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''));
  while (words.length > 1 && isNoise(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[\s\-–—:_|/]+$/, '').trim() || String(raw ?? '').trim();
}
