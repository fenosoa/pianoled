'use strict';

const dgram = require('node:dgram');

/**
 * Unicast UDP transport for DDP packets. One socket, so packets leave in call order.
 * UDP gives no delivery feedback: a resolved send only means the OS accepted the datagram.
 */
class UdpTransport {
  constructor({ host, port, dryRun = false, createSocket = dgram.createSocket, logger = console }) {
    this.host = host;
    this.port = port;
    this.dryRun = dryRun;
    this.logger = logger;
    this.stats = { packets: 0, bytes: 0, errors: 0, lastError: null };
    this.closed = false;
    this.socket = null;
    if (!dryRun) {
      this.socket = createSocket('udp4');
      // Without a listener an asynchronous socket error would crash the process.
      this.socket.on('error', (err) => this.recordError(err));
    }
  }

  recordError(err) {
    this.stats.errors++;
    if (!this.stats.lastError || this.stats.lastError.code !== err.code) {
      this.logger.warn?.(`[ddp] send error to ${this.host}:${this.port}: ${err.code || err.message}`);
    }
    this.stats.lastError = { code: err.code || 'ERR', message: err.message, at: new Date().toISOString() };
  }

  send(packet) {
    if (this.closed) return Promise.resolve(new Error('transport closed'));
    if (this.dryRun) {
      this.stats.packets++;
      this.stats.bytes += packet.length;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.socket.send(packet, this.port, this.host, (err) => {
        if (err) {
          this.recordError(err);
          resolve(err);
        } else {
          this.stats.packets++;
          this.stats.bytes += packet.length;
          resolve(null);
        }
      });
    });
  }

  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    if (!this.socket) return Promise.resolve();
    return new Promise((resolve) => this.socket.close(() => resolve()));
  }
}

/** In-memory transport for tests: keeps every packet. */
class MemoryTransport {
  constructor() {
    this.packets = [];
    this.stats = { packets: 0, bytes: 0, errors: 0, lastError: null };
    this.closed = false;
    this.dryRun = true;
  }

  send(packet) {
    this.packets.push(Buffer.from(packet));
    this.stats.packets++;
    this.stats.bytes += packet.length;
    return Promise.resolve(null);
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

module.exports = { UdpTransport, MemoryTransport };
