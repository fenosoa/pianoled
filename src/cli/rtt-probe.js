#!/usr/bin/env node
'use strict';

/*
 * RTP-MIDI round-trip probe (Pi side). Method:
 *   Pi sends Note On ch16 (note = probe id) on RTT_OUT_PORT -> network -> Windows `tools/windows/rtp-echo.js`
 *   echoes it back -> Pi receives it on RTT_IN_PORT. RTT is measured with one monotonic clock (no clock sync).
 *   One-way latency is only estimated as RTT/2; jitter is reported as stdev and p95-p50 of RTT.
 * This measures the MIDI network path only, not Synthesia processing and not LED optical latency.
 */
const { loadMidi, listPorts, findPort } = require('../adapters/midi-backend');
const { monotonicMs, SampleStats, fmtStats } = require('../metrics');
const { parseArgs, loadCliConfig } = require('./common');

const args = parseArgs();
const { config } = loadCliConfig(args);
const outMatch = args.out || process.env.RTT_OUT_PORT || config.midi.synthesiaOut;
const inMatch = args.in || process.env.RTT_IN_PORT || config.midi.synthesiaIn;
const count = Number(args.count) || 200;
const intervalMs = Number(args.interval) || 50;
const timeoutMs = Number(args.timeout) || 1000;

const midi = loadMidi();
const ports = listPorts(midi);
const oi = findPort(ports.outputs, outMatch);
const ii = findPort(ports.inputs, inMatch);
if (oi < 0 || ii < 0) {
  console.error(`Ports not found: out "${outMatch}" -> ${oi}, in "${inMatch}" -> ${ii}`);
  process.exit(1);
}
const output = new midi.Output();
const input = new midi.Input();
input.ignoreTypes(true, true, true);
output.openPort(oi);
input.openPort(ii);

const pending = new Map();
const rtt = new SampleStats();
let lost = 0;
input.on('message', (_d, bytes) => {
  if (bytes[0] !== 0x9f) return;
  const sentAt = pending.get(bytes[1]);
  if (sentAt === undefined) return;
  pending.delete(bytes[1]);
  rtt.add(monotonicMs() - sentAt);
});

console.log(`RTT probe: ${count} probes every ${intervalMs}ms, out="${ports.outputs[oi]}" in="${ports.inputs[ii]}" (channel 16)`);
console.log('Close Synthesia or disconnect it from this port during the test so probes are not played.');
let i = 0;
const timer = setInterval(() => {
  const now = monotonicMs();
  for (const [id, at] of pending) {
    if (now - at > timeoutMs) {
      pending.delete(id);
      lost++;
    }
  }
  if (i >= count) {
    if (pending.size === 0 || now - Math.max(...pending.values()) > timeoutMs) finish();
    return;
  }
  const id = i % 128;
  if (pending.has(id)) lost++;
  pending.set(id, monotonicMs());
  output.sendMessage([0x9f, id, 1]);
  output.sendMessage([0x8f, id, 0]);
  i++;
}, intervalMs);

function finish() {
  clearInterval(timer);
  lost += pending.size;
  const s = rtt.summary();
  console.log(`RTT        : ${fmtStats(s)}`);
  if (s.count) console.log(`one-way est: ~${(s.p50 / 2).toFixed(2)} ms (RTT/2, assumes symmetric path); jitter p95-p50=${(s.p95 - s.p50).toFixed(2)} ms`);
  console.log(`lost       : ${lost}/${count}`);
  input.closePort();
  output.closePort();
  process.exit(0);
}
