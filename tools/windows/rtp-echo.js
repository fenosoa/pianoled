#!/usr/bin/env node
'use strict';

/*
 * Windows side of the RTT measurement: echoes channel-16 notes received on an rtpMIDI session port.
 * Usage: node tools/windows/rtp-echo.js --in "<rtpMIDI session name>" --out "<rtpMIDI session name>"
 * Run `node tools/windows/rtp-echo.js --list` to see the exact port names rtpMIDI created.
 */
const { loadMidi, listPorts, findPort } = require('../../src/adapters/midi-backend');
const { parseArgs } = require('../../src/cli/common');

const args = parseArgs();
const midi = loadMidi();
const ports = listPorts(midi);
if (args.list || !args.in || !args.out) {
  console.log('Inputs :', ports.inputs);
  console.log('Outputs:', ports.outputs);
  if (!args.list) console.log('Usage: --in "<name substring>" --out "<name substring>"');
  process.exit(0);
}
const ii = findPort(ports.inputs, args.in);
const oi = findPort(ports.outputs, args.out);
if (ii < 0 || oi < 0) {
  console.error(`Ports not found (in=${ii}, out=${oi})`);
  process.exit(1);
}
const input = new midi.Input();
const output = new midi.Output();
input.ignoreTypes(true, true, true);
output.openPort(oi);
let echoed = 0;
input.on('message', (_d, bytes) => {
  // Only channel 16 probes are echoed, so no regular note can loop back.
  if (bytes[0] === 0x9f || bytes[0] === 0x8f) {
    output.sendMessage(bytes);
    echoed++;
  }
});
input.openPort(ii);
console.log(`Echoing ch16 from "${ports.inputs[ii]}" to "${ports.outputs[oi]}". Ctrl+C to stop.`);
setInterval(() => process.stdout.write(`\rechoed=${echoed}`), 1000);
process.on('SIGINT', () => {
  input.closePort();
  output.closePort();
  console.log('');
  process.exit(0);
});
