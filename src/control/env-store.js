'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('../config/env-file');
const { loadConfig, ConfigError } = require('../config');
const { FIELDS, KEYS } = require('./schema');

class EnvStore {
  constructor({ baseDir = process.cwd(), file = '.env' } = {}) {
    this.baseDir = baseDir;
    this.file = path.resolve(baseDir, file);
    this.example = path.resolve(baseDir, '.env.example');
  }

  /** Values from the file (strings), restricted to known keys. Falls back to .env.example when .env is absent. */
  read() {
    const src = fs.existsSync(this.file) ? this.file : this.example;
    const parsed = fs.existsSync(src) ? parseEnv(fs.readFileSync(src, 'utf8')) : {};
    return Object.fromEntries(KEYS.filter((k) => k in parsed).map((k) => [k, parsed[k]]));
  }

  /** Effective values: file value, else schema default. */
  effective() {
    const file = this.read();
    return Object.fromEntries(FIELDS.map((f) => [f.key, file[f.key] !== undefined ? file[f.key] : f.def]));
  }

  /** Uses the exact loader of the service so UI and runtime never disagree. */
  validate(values) {
    const env = {};
    for (const [k, v] of Object.entries(values)) if (KEYS.includes(k) && v !== '') env[k] = String(v);
    try {
      const cfg = loadConfig(env, { baseDir: this.baseDir });
      const warnings = [];
      const m = cfg.midi;
      if (!m.keyboardIn && !m.synthesiaIn) warnings.push('Aucune entrée MIDI configurée : le service refusera de démarrer.');
      if (m.keyboardIn && m.synthesiaIn && m.keyboardIn.toLowerCase() === m.synthesiaIn.toLowerCase()) {
        warnings.push('Entrées clavier et Synthesia identiques : le service refusera de démarrer.');
      }
      return { ok: true, warnings };
    } catch (err) {
      if (err instanceof ConfigError) return { ok: false, error: err.message };
      throw err;
    }
  }

  /** Rewrites .env keeping comments/order; unknown keys are untouched, new keys appended. */
  write(values) {
    const base = fs.existsSync(this.file) ? this.file : fs.existsSync(this.example) ? this.example : null;
    const lines = base ? fs.readFileSync(base, 'utf8').split(/\r?\n/) : [];
    const pending = new Map(Object.entries(values).filter(([k]) => KEYS.includes(k)).map(([k, v]) => [k, String(v)]));
    const out = lines.map((line) => {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m && pending.has(m[1])) {
        const v = pending.get(m[1]);
        pending.delete(m[1]);
        return `${m[1]}=${v}`;
      }
      return line;
    });
    if (pending.size) {
      while (out.length && out[out.length - 1] === '') out.pop();
      out.push('', '# ---- Added by the control UI ----');
      for (const [k, v] of pending) out.push(`${k}=${v}`);
    }
    if (out[out.length - 1] !== '') out.push('');
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, out.join('\n'), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { EnvStore };
