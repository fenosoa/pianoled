'use strict';

const { SOURCES } = require('../constants');
const { CC } = require('../midi/messages');

/*
 * Note state per source and per channel.
 *
 * - `pressed`: key physically held (or Note On received without Note Off).
 * - `sustained`: key released while the sustain pedal was down (still sounding).
 * Display policy (SUSTAIN_MODE):
 *   keys  -> lit only while pressed (default).
 *   sound -> lit while pressed or sustained.
 * Duplicate policy: state is boolean per (source, channel, note); a repeated Note On is
 * idempotent and the first Note Off releases it, regardless of how many Note On were seen.
 */
class ChannelState {
  constructor() {
    this.pressed = new Set();
    this.sustained = new Set();
    this.pedal = false;
  }

  isEmpty() {
    return this.pressed.size === 0 && this.sustained.size === 0 && !this.pedal;
  }
}

class SourceState {
  constructor(name) {
    this.name = name;
    this.channels = new Map();
  }

  channel(ch) {
    let state = this.channels.get(ch);
    if (!state) {
      state = new ChannelState();
      this.channels.set(ch, state);
    }
    return state;
  }

  apply(event) {
    const cs = this.channel(event.channel);
    switch (event.type) {
      case 'noteon': {
        const changed = !cs.pressed.has(event.note) || cs.sustained.has(event.note);
        cs.pressed.add(event.note);
        cs.sustained.delete(event.note);
        return changed;
      }
      case 'noteoff': {
        if (!cs.pressed.delete(event.note)) return false;
        if (cs.pedal) cs.sustained.add(event.note);
        return true;
      }
      case 'cc':
        return this.applyControl(cs, event.controller, event.value);
      default:
        return false;
    }
  }

  applyControl(cs, controller, value) {
    if (controller === CC.SUSTAIN) {
      const down = value >= 64;
      if (down === cs.pedal) return false;
      cs.pedal = down;
      if (!down) cs.sustained.clear();
      return true;
    }
    if (controller === CC.RESET_ALL_CONTROLLERS) {
      const changed = cs.pedal || cs.sustained.size > 0;
      cs.pedal = false;
      cs.sustained.clear();
      return changed;
    }
    // 120 All Sound Off, 123 All Notes Off and 124..127 (mode messages imply All Notes Off).
    // Stricter than the MIDI spec on purpose: sustained notes are cleared too to avoid stuck LEDs.
    if (controller === CC.ALL_SOUND_OFF || controller >= CC.ALL_NOTES_OFF) {
      const changed = cs.pressed.size > 0 || cs.sustained.size > 0;
      cs.pressed.clear();
      cs.sustained.clear();
      return changed;
    }
    return false;
  }

  clear() {
    const had = [...this.channels.values()].some((cs) => !cs.isEmpty());
    this.channels.clear();
    return had;
  }

  /** Map<note, number[]> of channels for which the note must be displayed. */
  litNotes(sustainMode) {
    const out = new Map();
    for (const [ch, cs] of this.channels) {
      const add = (note) => {
        const list = out.get(note);
        if (list) {
          if (!list.includes(ch)) list.push(ch);
        } else out.set(note, [ch]);
      };
      cs.pressed.forEach(add);
      if (sustainMode === 'sound') cs.sustained.forEach(add);
    }
    for (const list of out.values()) list.sort((a, b) => a - b);
    return out;
  }

  counts() {
    let pressed = 0;
    let sustained = 0;
    for (const cs of this.channels.values()) {
      pressed += cs.pressed.size;
      sustained += cs.sustained.size;
    }
    return { pressed, sustained };
  }
}

class NoteStateStore {
  constructor({ sustainMode = 'keys' } = {}) {
    this.sustainMode = sustainMode;
    this.sources = Object.fromEntries(SOURCES.map((s) => [s, new SourceState(s)]));
  }

  apply(event) {
    const src = this.sources[event.source];
    if (!src) throw new Error(`unknown source "${event.source}"`);
    return src.apply(event);
  }

  clearSource(source) {
    const src = this.sources[source];
    if (!src) throw new Error(`unknown source "${source}"`);
    return src.clear();
  }

  clearAll() {
    return SOURCES.map((s) => this.sources[s].clear()).some(Boolean);
  }

  litNotes(source) {
    return this.sources[source].litNotes(this.sustainMode);
  }

  counts() {
    return Object.fromEntries(SOURCES.map((s) => [s, this.sources[s].counts()]));
  }
}

module.exports = { NoteStateStore, SourceState };
