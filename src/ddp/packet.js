'use strict';

const { FRAME_BYTES } = require('../constants');

const HEADER_LENGTH = 10;

/**
 * DDP packet identical to the validated test-ddp.js header:
 *   [0] 0x41 version 1 + PUSH, [1] sequence (low nibble), [2] 0x0b RGB 8-bit,
 *   [3] 0x01 default output, [4..7] data offset BE, [8..9] data length BE.
 */
function encodeDdpPacket(pixels, sequence, { offset = 0 } = {}) {
  if (!Buffer.isBuffer(pixels)) throw new TypeError('pixels must be a Buffer');
  if (pixels.length !== FRAME_BYTES) throw new RangeError(`frame must be ${FRAME_BYTES} bytes, got ${pixels.length}`);
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 15) throw new RangeError(`invalid sequence ${sequence}`);
  const header = Buffer.alloc(HEADER_LENGTH);
  header[0] = 0x41;
  header[1] = sequence & 0x0f;
  header[2] = 0x0b;
  header[3] = 0x01;
  header.writeUInt32BE(offset, 4);
  header.writeUInt16BE(pixels.length, 8);
  return Buffer.concat([header, pixels]);
}

function decodeDdpHeader(packet) {
  return {
    flags: packet[0],
    version: packet[0] >> 6,
    push: (packet[0] & 0x01) === 1,
    sequence: packet[1] & 0x0f,
    dataType: packet[2],
    destination: packet[3],
    offset: packet.readUInt32BE(4),
    length: packet.readUInt16BE(8),
  };
}

// DDP reserves sequence 0 for "not used", so the counter cycles 1..15.
function nextSequence(seq) {
  return seq >= 15 ? 1 : seq + 1;
}

module.exports = { encodeDdpPacket, decodeDdpHeader, nextSequence, HEADER_LENGTH };
