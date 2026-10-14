'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { KEYS } = require('./schema');

const MAX_LOGS = 500;

/** Supervises the LED service (src/cli/run.js) as a child process: start / graceful stop / restart. */
class Runner extends EventEmitter {
  constructor({ baseDir = process.cwd(), args = [] } = {}) {
    super();
    this.baseDir = baseDir;
    this.args = args;
    this.child = null;
    this.state = 'stopped'; // stopped | starting | running | stopping | crashed
    this.startedAt = null;
    this.lastExit = null;
    this.restarts = 0;
    this.logs = [];
    this.seq = 0;
  }

  status() {
    return {
      state: this.state,
      pid: this.child ? this.child.pid : null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      restarts: this.restarts,
    };
  }

  _setState(state) {
    this.state = state;
    this.emit('status', this.status());
  }

  _log(stream, text) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      const entry = { id: ++this.seq, t: Date.now(), stream, line };
      this.logs.push(entry);
      if (this.logs.length > MAX_LOGS) this.logs.shift();
      this.emit('log', entry);
    }
  }

  start() {
    if (this.child) return false;
    // The .env file must be the source of truth: drop any inherited override of the known keys.
    const env = { ...process.env };
    for (const k of KEYS) delete env[k];
    this._log('system', 'Démarrage du service…');
    const child = spawn(process.execPath, [path.join(this.baseDir, 'src/cli/run.js'), ...this.args], {
      cwd: this.baseDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    this.child = child;
    this.startedAt = Date.now();
    this._setState('starting');
    const readyTimer = setTimeout(() => {
      if (this.child === child && this.state === 'starting') this._setState('running');
    }, 1200);
    child.stdout.on('data', (d) => this._log('out', d));
    child.stderr.on('data', (d) => this._log('err', d));
    child.on('error', (err) => this._log('err', `spawn: ${err.message}`));
    child.on('exit', (code, signal) => {
      clearTimeout(readyTimer);
      const expected = this.state === 'stopping';
      this.lastExit = { code, signal, at: Date.now() };
      this.child = null;
      this.startedAt = null;
      this._log('system', `Service arrêté (code=${code}${signal ? `, signal=${signal}` : ''}).`);
      this._setState(expected || code === 0 ? 'stopped' : 'crashed');
    });
    return true;
  }

  /** Graceful stop through IPC so black frames are sent (SIGTERM would hard-kill on Windows). */
  stop(timeoutMs = 5000) {
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      this._setState('stopping');
      const kill = setTimeout(() => {
        this._log('system', 'Arrêt gracieux trop long : kill forcé.');
        child.kill('SIGKILL');
      }, timeoutMs);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      try {
        child.send({ type: 'shutdown' });
      } catch {
        child.kill();
      }
    });
  }

  async restart() {
    await this.stop();
    this.restarts++;
    return this.start();
  }

  panic(source) {
    if (!this.child) return false;
    this.child.send({ type: 'panic', source });
    return true;
  }
}

module.exports = { Runner };
