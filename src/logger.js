'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(level = 'info', sink = console) {
  const max = LEVELS[level] ?? LEVELS.info;
  const log = (lvl, fn) => (...args) => {
    if (LEVELS[lvl] <= max) fn.call(sink, ...args);
  };
  return {
    level,
    error: log('error', sink.error),
    warn: log('warn', sink.warn),
    info: log('info', sink.log),
    debug: log('debug', sink.log),
  };
}

const silentLogger = { level: 'error', error() {}, warn() {}, info() {}, debug() {} };

module.exports = { createLogger, silentLogger };
