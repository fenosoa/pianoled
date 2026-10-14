'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LED_COUNT } = require('../constants');

/** Reads/writes config/note-map.json ({ _comment?, map: { "midiNote": ledIndex } }) with strict validation. */
class NoteMapStore {
  constructor({ baseDir = process.cwd(), file = 'config/note-map.json' } = {}) {
    this.file = path.resolve(baseDir, file);
  }

  _raw() {
    try {
      const json = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return json && typeof json.map === 'object' ? json : { map: json };
    } catch (err) {
      if (err.code === 'ENOENT') return { map: {} };
      throw err;
    }
  }

  read() {
    const raw = this._raw();
    const map = {};
    for (const [k, v] of Object.entries(raw.map)) if (!k.startsWith('_')) map[k] = v;
    return { map, comment: raw._comment || '', ledCount: LED_COUNT, exists: fs.existsSync(this.file) };
  }

  validate(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return { ok: false, error: 'La table doit être un objet { note: led }.' };
    const used = new Map();
    for (const [k, v] of Object.entries(map)) {
      const note = Number(k);
      if (!/^\d+$/.test(k) || note > 127) return { ok: false, error: `Note MIDI invalide « ${k} » (0..127).` };
      if (!Number.isInteger(v) || v < 0 || v >= LED_COUNT) return { ok: false, error: `Note ${k} : LED ${JSON.stringify(v)} hors de [0,${LED_COUNT - 1}].` };
      if (!used.has(v)) used.set(v, []);
      used.get(v).push(note);
    }
    const warnings = [];
    for (const [led, notes] of used) if (notes.length > 1) warnings.push(`LED ${led} partagée par les notes ${notes.join(', ')}.`);
    return { ok: true, warnings };
  }

  /** Sorted by note, keeps _comment, previous file saved as .bak, atomic replace. */
  write(map) {
    const prev = this._raw();
    const sorted = {};
    for (const k of Object.keys(map).map(Number).sort((a, b) => a - b)) sorted[String(k)] = map[k];
    const out = {};
    if (prev._comment) out._comment = prev._comment;
    out.map = sorted;
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { NoteMapStore };
