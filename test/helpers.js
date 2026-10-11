'use strict';

const { loadConfig } = require('../src/config');
const { LedEngine } = require('../src/engine');
const { MemoryTransport } = require('../src/ddp/transport');

function testConfig(env = {}) {
  return loadConfig({ KEEPALIVE: 'off', BRIGHTNESS: '1', ...env });
}

function makeEngine(env = {}) {
  const transport = new MemoryTransport();
  const engine = new LedEngine(testConfig(env), { transport });
  return { engine, transport };
}

module.exports = { testConfig, makeEngine };
