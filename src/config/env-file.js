'use strict';

const fs = require('node:fs');

// Minimal KEY=VALUE parser so the project needs no dotenv dependency.
function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

// Real environment variables always win over the file.
function loadEnvFile(path, env = process.env) {
  if (!path || !fs.existsSync(path)) return false;
  const parsed = parseEnv(fs.readFileSync(path, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined) env[k] = v;
  }
  return true;
}

module.exports = { parseEnv, loadEnvFile };
