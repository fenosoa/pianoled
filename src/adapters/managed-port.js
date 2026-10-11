'use strict';

const { EventEmitter } = require('node:events');
const { findPort } = require('./midi-backend');
const { monotonicMs } = require('../metrics');
const { silentLogger } = require('../logger');

/**
 * A MIDI port selected by name substring, polled for (dis)appearance and reopened automatically.
 * Events: 'connected'(name), 'disconnected'(name), 'message'(bytes, monotonicMs) for inputs.
 * Disconnect detection relies on the port vanishing from the system list; a port that stays
 * listed while its remote peer is gone (possible with RTP-MIDI) is not detected here.
 */
class ManagedPort extends EventEmitter {
  constructor({ midi, direction, match, label, pollMs = 2000, logger = silentLogger }) {
    super();
    if (direction !== 'input' && direction !== 'output') throw new Error(`invalid direction ${direction}`);
    this.midi = midi;
    this.direction = direction;
    this.match = match;
    this.label = label;
    this.pollMs = pollMs;
    this.logger = logger;
    this.device = null;
    this.portName = null;
    this.timer = null;
    this.stats = { messages: 0, dropped: 0, connects: 0, disconnects: 0 };
    this.lister = null;
  }

  get connected() {
    return this.device !== null;
  }

  start() {
    if (!this.match) {
      this.logger.warn(`[${this.label}] no port configured, disabled`);
      return;
    }
    const Ctor = this.direction === 'input' ? this.midi.Input : this.midi.Output;
    this.lister = new Ctor();
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  names() {
    const names = [];
    for (let i = 0; i < this.lister.getPortCount(); i++) names.push(this.lister.getPortName(i));
    return names;
  }

  poll() {
    let names;
    try {
      names = this.names();
    } catch (err) {
      this.logger.warn(`[${this.label}] port enumeration failed: ${err.message}`);
      return;
    }
    if (this.device) {
      if (!names.includes(this.portName)) this.close('port disappeared');
      return;
    }
    const index = findPort(names, this.match);
    if (index >= 0) this.open(index, names[index]);
  }

  open(index, name) {
    const Ctor = this.direction === 'input' ? this.midi.Input : this.midi.Output;
    const dev = new Ctor();
    try {
      if (this.direction === 'input') {
        // Ignore sysex, timing clock and active sensing; keep channel messages.
        dev.ignoreTypes(true, true, true);
        dev.on('message', (_delta, message) => {
          this.stats.messages++;
          this.emit('message', message, monotonicMs());
        });
      }
      dev.openPort(index);
    } catch (err) {
      this.logger.warn(`[${this.label}] cannot open "${name}": ${err.message}`);
      return;
    }
    this.device = dev;
    this.portName = name;
    this.stats.connects++;
    this.logger.info(`[${this.label}] connected to "${name}"`);
    this.emit('connected', name);
  }

  close(reason) {
    if (!this.device) return;
    const name = this.portName;
    try {
      this.device.closePort();
      if (typeof this.device.destroy === 'function') this.device.destroy();
    } catch (_) {
      // Port already gone; nothing else to release.
    }
    this.device = null;
    this.portName = null;
    this.stats.disconnects++;
    this.logger.warn(`[${this.label}] disconnected from "${name}" (${reason})`);
    this.emit('disconnected', name);
  }

  send(bytes) {
    if (!this.device || this.direction !== 'output') {
      this.stats.dropped++;
      return false;
    }
    try {
      this.device.sendMessage(bytes);
      this.stats.messages++;
      return true;
    } catch (err) {
      this.stats.dropped++;
      this.close(`send failed: ${err.message}`);
      return false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.close('stopped');
    if (this.lister && typeof this.lister.destroy === 'function') this.lister.destroy();
    this.lister = null;
  }
}

module.exports = { ManagedPort };
