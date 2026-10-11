'use strict';

/**
 * Loads the RtMidi binding lazily so Step 2 (simulation) runs without any native dependency.
 * @julusian/midi is a maintained node-midi fork shipping prebuilt binaries (ALSA sequencer on Linux,
 * WinMM on Windows). rtpmidid exposes RTP-MIDI sessions as ALSA sequencer ports, so they appear here.
 */
function loadMidi() {
  try {
    return require('@julusian/midi');
  } catch (err) {
    const e = new Error(
      'MIDI backend "@julusian/midi" is not installed. Run `npm install` (it is an optionalDependency). ' +
        `On Raspberry Pi OS install libasound2-dev first if no prebuilt binary matches. Cause: ${err.message}`
    );
    e.code = 'MIDI_BACKEND_MISSING';
    throw e;
  }
}

function listPorts(midi = loadMidi()) {
  const enumerate = (Ctor) => {
    const dev = new Ctor();
    const names = [];
    for (let i = 0; i < dev.getPortCount(); i++) names.push(dev.getPortName(i));
    if (typeof dev.destroy === 'function') dev.destroy();
    return names;
  };
  return { inputs: enumerate(midi.Input), outputs: enumerate(midi.Output) };
}

/** Case-insensitive substring match: client/port numbers in ALSA names may change on reconnect. */
function findPort(names, match) {
  if (!match) return -1;
  const needle = match.toLowerCase();
  return names.findIndex((n) => n.toLowerCase().includes(needle));
}

module.exports = { loadMidi, listPorts, findPort };
