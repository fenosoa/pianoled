'use strict';

const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NO_CHORD = new Set(['', 'N', 'NC', 'N.C', 'N.C.', 'X', '-', '--', '*']);
// Chordify writes the bass as an interval ("E:min/b3"); classic charts write a note ("G/B").
const INTERVALS = { 1: 0, b2: 1, 2: 2, b3: 3, 3: 4, 4: 5, b5: 6, 5: 7, '#5': 8, b6: 8, 6: 9, b7: 10, 7: 11, 9: 2 };

function parseNote(text) {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(text);
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return (ROOTS[m[1].toUpperCase()] + acc + 12) % 12;
}

// Extensions we deliberately drop (9 and above are simplified to the 7th chord).
const IGNORED = /^(add\d+|[b#]9|[b#]11|[b#]13|alt|no\d+|omit\d+|\d+)/;

/** Quality string (what follows the root) -> { intervals, minor } or null. */
function parseQuality(input) {
  let rest = input.replace(/\(([^)]*)\)/g, '$1').replace(/\s+/g, '');
  const eat = (re) => {
    const m = re.exec(rest);
    if (m) rest = rest.slice(m[0].length);
    return m;
  };
  let third = 4;
  let fifth = 7;
  let seventh = null;
  let sixth = false;
  let power = false;
  let minor = false;

  if (eat(/^(hdim7?|ø7?|m7b5|min7b5)/)) {
    third = 3;
    fifth = 6;
    seventh = 10;
    minor = true;
  } else if (eat(/^(dim|o)/)) {
    third = 3;
    fifth = 6;
    minor = true;
    if (eat(/^7/)) seventh = 9;
  } else if (eat(/^(aug|\+)/)) {
    fifth = 8;
    if (eat(/^(7|9)/)) seventh = 10;
  } else if (eat(/^(maj|M|Δ)/)) {
    if (eat(/^(7|9|11|13)/)) seventh = 11;
    else if (eat(/^6/)) sixth = true;
  } else if (eat(/^(min|m|-)/)) {
    third = 3;
    minor = true;
    if (eat(/^(maj|M)(7|9)?/)) seventh = 11;
    else if (eat(/^6/)) sixth = true;
    else if (eat(/^(7|9|11|13)/)) seventh = 10;
  } else if (eat(/^6/)) {
    sixth = true;
  } else if (eat(/^(7|9|11|13)/)) {
    seventh = 10;
  } else if (rest === '5') {
    rest = '';
    power = true;
  }

  while (rest) {
    if (eat(/^sus2/)) third = 2;
    else if (eat(/^sus4?/)) third = 5;
    else if (eat(/^(b5|-5)/)) fifth = 6;
    else if (eat(/^(#5|\+5)/)) fifth = 8;
    else if (eat(IGNORED)) continue;
    else return null;
  }

  const intervals = [0, third, fifth];
  if (power) intervals.splice(1, 1);
  if (sixth) intervals.push(9);
  if (seventh !== null) intervals.push(seventh);
  return { intervals, minor };
}

/**
 * "Em", "G7", "Cmaj7", "E:min", "D:min7", "G/B", "D/F#" -> { name, root, minor, bass, pcs }.
 * pcs is a sorted list of pitch classes (0..11) that includes the bass. Returns null for
 * empty / N.C. / unparseable names: callers must treat that as "no chord", never throw.
 */
function parseChord(name) {
  if (typeof name !== 'string') return null;
  const text = name.trim();
  if (NO_CHORD.has(text.toUpperCase())) return null;

  const slash = text.indexOf('/');
  const main = slash === -1 ? text : text.slice(0, slash);
  const bassText = slash === -1 ? '' : text.slice(slash + 1).trim();

  const m = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(main);
  if (!m) return null;
  const root = parseNote(m[1] + m[2]);
  const quality = parseQuality(m[3].replace(/^:/, ''));
  if (root === null || !quality) return null;

  const pcs = new Set(quality.intervals.map((i) => (root + i) % 12));
  let bass = null;
  if (bassText) {
    const note = parseNote(bassText);
    if (note !== null) bass = note;
    else if (bassText in INTERVALS) bass = (root + INTERVALS[bassText]) % 12;
    // Unreadable bass: ignored, the chord itself is still valid.
  }
  if (bass !== null) pcs.add(bass);

  return { name: text, root, minor: quality.minor, bass, pcs: [...pcs].sort((a, b) => a - b) };
}

module.exports = { parseChord, parseNote };
