'use strict';

const BACKOFF_MS = [1000, 2000, 5000]; // then 5 s forever
const CONNECT_TIMEOUT_MS = 5000;

function defaultWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket; // Node >= 22
  try {
    return require('ws'); // Node 20: `npm i ws`
  } catch {
    throw new Error('No WebSocket client available: use Node >= 22 or run `npm install ws`');
  }
}

/**
 * Self-reconnecting WebSocket client. Fully event driven (never blocks the LED/MIDI loop) and never throws
 * from its callbacks: a listener error is logged and swallowed.
 */
class KaraokeSocket {
  constructor({ url, onMessage, onConnect, onDisconnect, logger, WebSocketImpl, backoffMs = BACKOFF_MS, connectTimeoutMs = CONNECT_TIMEOUT_MS }) {
    this.url = url;
    this.handlers = { onMessage, onConnect, onDisconnect };
    this.logger = logger;
    this.WebSocketImpl = WebSocketImpl || null;
    this.backoffMs = backoffMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.attempt = 0;
    this.stopped = true;
    this.ws = null;
    this.timer = null;
    this.connected = false;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    this.detach(ws);
    this.setConnected(false);
  }

  safe(fn, ...args) {
    try {
      if (fn) fn(...args);
    } catch (err) {
      this.logger.error(`[karaoke] handler error: ${err.stack || err.message}`);
    }
  }

  setConnected(value) {
    if (this.connected === value) return;
    this.connected = value;
    this.safe(value ? this.handlers.onConnect : this.handlers.onDisconnect);
  }

  detach(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.onerror = () => {}; // a late error on a closing socket must not become an uncaught exception
      ws.close();
    } catch {
      /* already closed */
    }
  }

  open() {
    if (this.stopped) return;
    let ws;
    try {
      this.WebSocketImpl = this.WebSocketImpl || defaultWebSocket();
      ws = new this.WebSocketImpl(this.url);
    } catch (err) {
      this.logger.warn(`[karaoke] cannot open ${this.url}: ${err.message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    const connectTimer = setTimeout(() => {
      this.logger.warn(`[karaoke] connect timeout (${this.url})`);
      this.lost(ws);
    }, this.connectTimeoutMs);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      this.attempt = 0;
      this.logger.info(`[karaoke] connected to ${this.url}`);
      try {
        // The hub only forwards its broadcasts to clients that announced themselves.
        ws.send(JSON.stringify({ type: 'hello', role: 'follower' }));
      } catch {
        /* the close handler takes over */
      }
      this.setConnected(true);
    };
    ws.onmessage = (event) => this.safe(this.handlers.onMessage, String(event.data));
    ws.onerror = () => {}; // always followed by onclose
    ws.onclose = () => {
      clearTimeout(connectTimer);
      this.lost(ws);
    };
  }

  lost(ws) {
    if (this.ws !== ws) return; // stale socket
    this.ws = null;
    this.detach(ws);
    this.setConnected(false);
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)];
    this.attempt++;
    this.logger.debug(`[karaoke] reconnect in ${delay} ms`);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), delay);
  }
}

module.exports = { KaraokeSocket };
