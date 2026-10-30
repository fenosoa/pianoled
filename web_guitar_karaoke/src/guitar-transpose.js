// Transposition guitare 100 % locale (aucun appel serveur).
//
// Entrée : la timeline Chordify du serveur ("beat;accord;start;end\n..."). Ses accords sont dans la tonalité « piano »
// (derivedKey : G ou Em) ; la hauteur réelle du morceau (originalKey) est décalée de `soundShift` demi-tons.
// Comme l'audio ne bouge pas, on ne transpose pas le son : on cherche le capo qui donne les FORMES les plus faciles.
// forme jouée = accord du fichier + soundShift − capo.

export const MAX_AUTO_CAPO = 7; // au-delà, le capo est jugé trop éloigné pour la recommandation
export const MAX_CAPO = 11;

// Réglages de la recommandation (unités = « coût d'un barré moyen »)
const CAPO_STEP_COST = 0.15; // chaque case de capo coûte un peu : le capo 0 reste la référence
const CAPO_FAR_FROM = 5; // au-delà de cette case, le coût grimpe plus vite
const CAPO_FAR_COST = 0.3;
const HARD_THRESHOLD = 1.3; // un accord plus difficile qu'un barré courant est « dur »
const HARD_WEIGHT = 0.5; // pénalité par accord dur distinct, même s'il est rare

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const mod12 = (n) => ((n % 12) + 12) % 12;

export const parseNote = (s) => {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(s ?? '');
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return mod12(LETTER_PC[m[1].toUpperCase()] + acc);
};

// --- QUALITÉS : id canonique → suffixe affiché + notes de l'accord (pour reconnaître une basse « dans l'accord ») ---
const QUALITIES = {
  maj: { label: '', tones: [0, 4, 7] },
  min: { label: 'm', tones: [0, 3, 7] },
  7: { label: '7', tones: [0, 4, 7, 10] },
  min7: { label: 'm7', tones: [0, 3, 7, 10] },
  maj7: { label: 'maj7', tones: [0, 4, 7, 11] },
  5: { label: '5', tones: [0, 7] },
  sus2: { label: 'sus2', tones: [0, 2, 7] },
  sus4: { label: 'sus4', tones: [0, 5, 7] },
  dim: { label: 'dim', tones: [0, 3, 6] },
  dim7: { label: 'dim7', tones: [0, 3, 6, 9] },
  aug: { label: 'aug', tones: [0, 4, 8] },
  maj6: { label: '6', tones: [0, 4, 7, 9] },
  min6: { label: 'm6', tones: [0, 3, 7, 9] },
  min9: { label: 'm9', tones: [0, 3, 7, 10, 2] },
  maj9: { label: 'maj9', tones: [0, 4, 7, 11, 2] },
  9: { label: '9', tones: [0, 4, 7, 10, 2] },
};
const ALIASES = { '': 'maj', M: 'maj', m: 'min', m7: 'min7', M7: 'maj7', 6: 'maj6', m6: 'min6', m9: 'min9', M9: 'maj9', hdim7: 'min7', 'min7b5': 'min7' };

// --- ANALYSE d'un accord Chordify ("D:maj/F#", "A:min7", "E:5", "N") ---
const chordCache = new Map();
export const parseChord = (raw) => {
  if (!raw || raw === 'N') return null;
  if (chordCache.has(raw)) return chordCache.get(raw);
  const m = /^([A-Ga-g][#b♯♭]?)(?::?([^/]*))?(?:\/([A-Ga-g][#b♯♭]?))?$/.exec(raw);
  const root = m && parseNote(m[1]);
  let chord = null;
  if (root != null) {
    const suffix = m[2] ?? '';
    const quality = QUALITIES[suffix] ? suffix : ALIASES[suffix] ?? null;
    chord = {
      root,
      quality: quality ?? suffix, // inconnu : conservé tel quel pour l'affichage
      known: quality != null,
      bass: m[3] ? parseNote(m[3]) : null,
    };
  }
  chordCache.set(raw, chord);
  return chord;
};

// --- DIFFICULTÉ d'une forme (0 = corde à vide, ~1 = barré, 2+ = pénible) ---
const OPEN_SHAPES = {
  maj: [0, 2, 4, 7, 9],
  min: [2, 4, 9],
  7: [0, 2, 4, 7, 9, 11],
  min7: [2, 4, 9],
  maj7: [0, 2, 4, 5, 7, 9],
  sus2: [0, 2, 9],
  sus4: [2, 4, 7, 9],
  maj6: [0, 7],
};
const BARRE_EXTRA = { maj: 0, min: 0.1, 7: 0.25, min7: 0.25, maj7: 0.5, sus4: 0.35, sus2: 0.5, maj6: 0.6 };
const POWER_COST = 0.3; // E5, A5… : deux cordes, déplaçables
const OVERRIDES = { 'F:maj': 0.8, 'F:maj7': 0.3 }; // petit F et Fmaj7 ouvert
const BARRE_BASE = 1;
const BARRE_PER_FRET = 0.12;
const DIM_COST = 1.8;
const COMPLEX_COST = 2.2;
const UNKNOWN_COST = 2.5;
const BASS_IN_CHORD = 0.2;
const BASS_OUTSIDE = 0.5;

export const chordDifficulty = ({ root, quality, known, bass }) => {
  let cost;
  if (!known) cost = UNKNOWN_COST;
  else if (quality === '5') cost = POWER_COST;
  else if (OVERRIDES[`${NAMES_SHARP[root]}:${quality}`] != null) cost = OVERRIDES[`${NAMES_SHARP[root]}:${quality}`];
  else if (OPEN_SHAPES[quality]?.includes(root)) cost = 0;
  else if (quality in BARRE_EXTRA) {
    // forme en E (racine sur la corde de Mi grave, case = root − 4) ou en A (case = root − 9) : on prend la plus basse
    const fret = Math.min(mod12(root - 4), mod12(root - 9));
    cost = BARRE_BASE + BARRE_PER_FRET * fret + BARRE_EXTRA[quality];
  } else if (quality === 'dim' || quality === 'dim7' || quality === 'aug') cost = DIM_COST;
  else cost = COMPLEX_COST;

  if (bass != null && bass !== root) {
    const inChord = (QUALITIES[quality]?.tones ?? [0, 7]).includes(mod12(bass - root));
    cost += inChord ? BASS_IN_CHORD : BASS_OUTSIDE;
  }
  return cost;
};

// --- ORTHOGRAPHE : bémols dans les tonalités à bémols, dièses sinon (Bb plutôt que A# sauf tonalités très diésées) ---
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
const SHARP_HEAVY_MAJOR = new Set([11, 6, 1]); // B F# C#
export const spellingFor = (tonicPc, minor) => {
  if (tonicPc == null) return { names: NAMES_SHARP, bb: true };
  const majorPc = minor ? mod12(tonicPc + 3) : tonicPc;
  if (FLAT_MAJOR.has(majorPc)) return { names: NAMES_FLAT, bb: true };
  return { names: NAMES_SHARP, bb: !SHARP_HEAVY_MAJOR.has(majorPc) };
};

const noteName = (pc, spelling) => (pc === 10 && spelling.bb ? 'Bb' : spelling.names[pc]);

// --- DÉCALAGE : forme jouée = accord du fichier + soundShift − capo ---
const shiftChord = (chord, semis) => ({
  ...chord,
  root: mod12(chord.root + semis),
  bass: chord.bass == null ? null : mod12(chord.bass + semis),
});

export const chordLabel = (chord, spelling) =>
  `${noteName(chord.root, spelling)}${QUALITIES[chord.quality]?.label ?? chord.quality}${chord.bass != null && chord.bass !== chord.root ? `/${noteName(chord.bass, spelling)}` : ''}`;

// Accord Chordify brut → { label, cost } tel que joué avec ce capo ('' pour « N » / vide)
export const playedChord = (raw, soundShift, capo, spelling) => {
  const chord = parseChord(raw);
  if (!chord) return { label: '', cost: 0 };
  const shifted = shiftChord(chord, soundShift - capo);
  return { label: chordLabel(shifted, spelling), cost: chordDifficulty(shifted) };
};

// --- PROFIL du morceau : durée cumulée de chaque accord distinct (un accord de 2 s pèse moins qu'un accord de 60 s) ---
export const buildProfile = (items) => {
  const seconds = new Map();
  let total = 0;
  for (const { chord, start, end } of items) {
    if (!parseChord(chord)) continue;
    const d = Math.max(0, (end ?? start) - start) || 0.5;
    seconds.set(chord, (seconds.get(chord) ?? 0) + d);
    total += d;
  }
  return { seconds, total };
};

export const evaluateCapo = (profile, soundShift, capo) => {
  let weighted = 0;
  let hardPenalty = 0;
  const hard = [];
  const spelling = { names: NAMES_SHARP, bb: true };
  for (const [raw, secs] of profile.seconds) {
    const { label, cost } = playedChord(raw, soundShift, capo, spelling);
    weighted += (cost * secs) / (profile.total || 1);
    if (cost > HARD_THRESHOLD) {
      hardPenalty += (cost - HARD_THRESHOLD) * HARD_WEIGHT;
      hard.push(label);
    }
  }
  const capoCost = CAPO_STEP_COST * capo + CAPO_FAR_COST * Math.max(0, capo - CAPO_FAR_FROM);
  return { capo, score: weighted + hardPenalty + capoCost, ease: weighted + hardPenalty, hard };
};

// Capo 0 d'abord, puis 1, 2… : celui qui a le meilleur score (facilité + coût du capo) gagne ; à égalité le plus bas
export const recommendCapo = (profile, soundShift, maxCapo = MAX_AUTO_CAPO) => {
  const candidates = [];
  for (let capo = 0; capo <= maxCapo; capo++) candidates.push(evaluateCapo(profile, soundShift, capo));
  const best = candidates.reduce((a, b) => (b.score < a.score - 1e-9 ? b : a));
  return { capo: best.capo, candidates };
};

// Barre de difficulté d'un accord pour l'interface : easy | barre | hard
export const difficultyClass = (cost) => (cost <= 0.45 ? 'easy' : cost <= HARD_THRESHOLD ? 'barre' : 'hard');

// --- LECTURE DU JSON SERVEUR ---
const findChords = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.chords === 'string') return node;
  for (const child of Object.values(node)) {
    const found = findChords(child);
    if (found) return found;
  }
  return null;
};

// Même contrat que normalizeTimeline de web_chords_karaoke
export const normalizeTimeline = (data) => {
  const holder = findChords(data);
  if (!holder) return data;
  const info = holder.chordInfo ?? {};
  return {
    bpm: info.derivedBpm,
    key_signature: info.derivedKey,
    original_key: info.originalKey,
    transpose_up: info.transposeUp,
    transpose_down: info.transposeDown,
    timeline: holder.chords,
  };
};

export const parseTimeline = (raw) =>
  (raw ?? '')
    .trim()
    .split('\n')
    .map((line, id) => {
      const p = line.split(';');
      if (p.length < 4) return null;
      return { id, beat: parseInt(p[0], 10), chord: p[1].replace(':', '') === 'N' ? '' : p[1], start: parseFloat(p[2]), end: parseFloat(p[3]) };
    })
    .filter(Boolean);

const keyInfo = (key) => {
  const m = /^([A-Ga-g][#b♯♭]?):?(maj|min)?/.exec(key ?? '');
  return m ? { pc: parseNote(m[1]), minor: m[2] === 'min' } : null;
};

// Décalage entre la timeline (tonalité piano) et le son réel
export const soundShiftOf = (data) => {
  const o = keyInfo(data?.original_key);
  const k = keyInfo(data?.key_signature);
  if (o && k && o.pc != null && k.pc != null) return mod12(o.pc - k.pc);
  if (Number.isFinite(data?.transpose_up)) return mod12(-data.transpose_up);
  if (Number.isFinite(data?.transpose_down)) return mod12(-data.transpose_down);
  return 0;
};

// Tout ce que l'interface a besoin de savoir d'un morceau, calculé une fois au chargement
export const analyzeSong = (data) => {
  const items = parseTimeline(data?.timeline);
  const soundShift = soundShiftOf(data);
  const profile = buildProfile(items);
  const { capo, candidates } = recommendCapo(profile, soundShift);
  const k = keyInfo(data?.key_signature);
  const soundKey = keyInfo(data?.original_key) ?? (k && { pc: mod12(k.pc + soundShift), minor: k.minor });
  return { items, soundShift, profile, recommended: capo, candidates, fileKey: k, soundKey };
};

// Jeu d'accords joués pour un capo donné
export const renderForCapo = (song, capo) => {
  const spelling = song.fileKey ? spellingFor(mod12(song.fileKey.pc + song.soundShift - capo), song.fileKey.minor) : spellingFor(null);
  const cache = new Map();
  const play = (raw) => {
    if (!cache.has(raw)) cache.set(raw, playedChord(raw, song.soundShift, capo, spelling));
    return cache.get(raw);
  };
  const shapeKey = song.fileKey && { pc: mod12(song.fileKey.pc + song.soundShift - capo), minor: song.fileKey.minor };
  return { play, spelling, shapeKey, keyName: (k) => (k ? `${noteName(k.pc, spelling)}${k.minor ? 'm' : ''}` : '--') };
};

// Nom d'une tonalité avec sa propre orthographe (ex. « Bb », « F#m »)
export const keyLabel = (key) => {
  if (!key || key.pc == null) return '--';
  return `${noteName(key.pc, spellingFor(key.pc, key.minor))}${key.minor ? 'm' : ''}`;
};
