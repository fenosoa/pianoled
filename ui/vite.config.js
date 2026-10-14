import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const target = process.env.CONTROL_URL || 'http://127.0.0.1:8787';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let commit = 'nogit';
try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}

export default defineConfig({
  plugins: [react()],
  define: { __UI_BUILD__: JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString() }) },
  server: { port: 5173, proxy: { '/api': target } },
});
