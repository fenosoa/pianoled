'use strict';

/*
 * Standard MIDI File (.mid) reader/writer, formats 0, 1 and 2, no dependency.
 * parseSmf() keeps channel messages as raw bytes; buildTimeline() merges tracks into one list
 * sorted by time, converted to milliseconds through the tempo map.
 */

const DEFAULT_TEMPO = 500000; // microseconds per quarter note (120 BPM)

class SmfError extends Error {}

function readVlq(buf, pos) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (pos >= buf.length) throw new SmfError('truncated variable-length quantity');
    const b = buf[pos++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return [value, pos];
  }
  throw new SmfError('variable-length quantity longer than 4 bytes');
}

function parseTrack(buf, index) {
  const events = [];
  let name = '';
  let pos = 0;
  let tick = 0;
  let running = null;
  while (pos < buf.length) {
    let delta;
    [delta, pos] = readVlq(buf, pos);
    tick += delta;
    if (pos >= buf.length) throw new SmfError(`track ${index}: truncated event`);
    let status = buf[pos];

    if (status === 0xff) {
      const type = buf[pos + 1];
      let len;
      [len, pos] = readVlq(buf, pos + 2);
      if (pos + len > buf.length) throw new SmfError(`track ${index}: truncated meta event`);
      const data = buf.subarray(pos, pos + len);
      pos += len;
      running = null;
      if (type === 0x51 && len === 3) events.push({ tick, kind: 'tempo', usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
      else if (type === 0x03 && !name) name = data.toString('latin1');
      else if (type === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      let len;
      [len, pos] = readVlq(buf, pos + 1);
      pos += len;
      running = null;
      continue;
    }
    if (status < 0x80) {
      if (running === null) throw new SmfError(`track ${index}: data byte without running status at tick ${tick}`);
      status = running;
    } else {
      pos++;
      running = status;
    }
    const kind = status & 0xf0;
    const size = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
    if (pos + size > buf.length) throw new SmfError(`track ${index}: truncated channel message`);
    const bytes = [status];
    for (let i = 0; i < size; i++) bytes.push(buf[pos + i]);
    pos += size;
    events.push({ tick, kind: 'midi', bytes });
  }
  return { name, events };
}

function parseSmf(buffer) {
  const buf = Buffer.from(buffer);
  if (buf.length < 14 || buf.toString('latin1', 0, 4) !== 'MThd') throw new SmfError('not a Standard MIDI File (missing MThd)');
  const headerLen = buf.readUInt32BE(4);
  const format = buf.readUInt16BE(8);
  const trackCount = buf.readUInt16BE(10);
  const division = buf.readUInt16BE(12);
  if (format > 2) throw new SmfError(`unsupported SMF format ${format}`);

  const tracks = [];
  let pos = 8 + headerLen;
  while (pos + 8 <= buf.length && tracks.length < trackCount) {
    const id = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32BE(pos + 4);
    const start = pos + 8;
    const end = Math.min(start + len, buf.length);
    if (id === 'MTrk') tracks.push(parseTrack(buf.subarray(start, end), tracks.length));
    pos = start + len;
  }
  if (tracks.length === 0) throw new SmfError('no MTrk chunk found');
  return { format, division, tracks };
}

function ticksToMsFactory(smf, tempoEvents) {
  if (smf.division & 0x8000) {
    // SMPTE timing: high byte is -fps (two's complement), low byte ticks per frame.
    const fpsCode = 256 - (smf.division >> 8);
    const fps = fpsCode === 29 ? 29.97 : fpsCode;
    const msPerTick = 1000 / (fps * (smf.division & 0xff));
    return (tick) => tick * msPerTick;
  }
  const tpq = smf.division;
  // Tempo map: segments starting at a tick with a known ms offset.
  const segments = [{ tick: 0, ms: 0, us: DEFAULT_TEMPO }];
  for (const t of tempoEvents) {
    const last = segments[segments.length - 1];
    const ms = last.ms + ((t.tick - last.tick) * last.us) / tpq / 1000;
    if (t.tick === last.tick) last.us = t.usPerQuarter;
    else segments.push({ tick: t.tick, ms, us: t.usPerQuarter });
  }
  return (tick) => {
    let seg = segments[0];
    for (const s of segments) {
      if (s.tick <= tick) seg = s;
      else break;
    }
    return seg.ms + ((tick - seg.tick) * seg.us) / tpq / 1000;
  };
}

/**
 * Merged, time-sorted channel events: { timeMs, tick, track, channel, bytes }.
 * Format 2 tracks are independent songs; only `track2Index` is used for them.
 * At equal ticks note-offs come first so a retriggered note is not cut by its own release.
 */
function buildTimeline(smf, { track2Index = 0 } = {}) {
  const tracks = smf.format === 2 ? [smf.tracks[track2Index]] : smf.tracks;
  const tempo = [];
  const midi = [];
  let seq = 0;
  tracks.forEach((track, t) => {
    const trackIndex = smf.format === 2 ? track2Index : t;
    for (const ev of track.events) {
      if (ev.kind === 'tempo') tempo.push(ev);
      else midi.push({ tick: ev.tick, track: trackIndex, bytes: ev.bytes, seq: seq++ });
    }
  });
  tempo.sort((a, b) => a.tick - b.tick);
  const isOff = (b) => (b[0] & 0xf0) === 0x80 || ((b[0] & 0xf0) === 0x90 && b[2] === 0);
  midi.sort((a, b) => a.tick - b.tick || Number(isOff(b.bytes)) - Number(isOff(a.bytes)) || a.seq - b.seq);
  const toMs = ticksToMsFactory(smf, tempo);
  return midi.map((e) => ({ timeMs: toMs(e.tick), tick: e.tick, track: e.track, channel: e.bytes[0] & 0x0f, bytes: e.bytes }));
}

function writeVlq(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

/**
 * Writes a format-1 SMF. tracks: [{ name?, events: [{ tick, bytes } | { tick, tempo: usPerQuarter }] }].
 */
function writeSmf({ division = 480, tracks }) {
  const chunks = [];
  const header = Buffer.alloc(14);
  header.write('MThd', 0, 'latin1');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(tracks.length, 10);
  header.writeUInt16BE(division, 12);
  chunks.push(header);
  for (const track of tracks) {
    const data = [];
    if (track.name) {
      const name = Buffer.from(track.name, 'latin1');
      data.push(0, 0xff, 0x03, ...writeVlq(name.length), ...name);
    }
    let last = 0;
    const sorted = [...track.events].sort((a, b) => a.tick - b.tick);
    for (const ev of sorted) {
      data.push(...writeVlq(ev.tick - last));
      last = ev.tick;
      if (ev.tempo) data.push(0xff, 0x51, 0x03, (ev.tempo >> 16) & 0xff, (ev.tempo >> 8) & 0xff, ev.tempo & 0xff);
      else data.push(...ev.bytes);
    }
    data.push(0, 0xff, 0x2f, 0x00);
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write('MTrk', 0, 'latin1');
    chunk.writeUInt32BE(data.length, 4);
    Buffer.from(data).copy(chunk, 8);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { parseSmf, buildTimeline, writeSmf, SmfError, readVlq, writeVlq };
