'use strict';

const { LED_COUNT, FRAME_BYTES } = require('../constants');

const SYMBOLS = { white: 'W', green: 'G', blue: 'B', red: 'R', cyan: 'C', yellow: 'Y', synthesia: 'S' };

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

function scale(rgb, brightness) {
  return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * brightness))));
}

/**
 * Resolves colors once at startup. Synthesia colors are chosen per channel (0..15) from config,
 * falling back to the documented default; no hand assignment is assumed.
 */
function createPalette({ colors, synthesia }) {
  const keyboard = { name: 'keyboard', symbol: 'W', rgb: scale(colors.keyboard, colors.brightness) };
  const overlap = { name: 'overlap', symbol: 'O', rgb: scale(colors.overlap, colors.brightness * colors.overlapBoost) };
  const synthBlack = { name: 'synthesia-black', symbol: 'K', rgb: scale(colors.synthesiaBlack, colors.brightness) };
  const synthByChannel = [];
  for (let ch = 0; ch < 16; ch++) {
    const name = synthesia.channelColors[ch] || synthesia.defaultColor;
    synthByChannel.push({ name, symbol: SYMBOLS[name] || '*', rgb: scale(colors.named[name], colors.brightness * (synthesia.channelBoost?.[ch] ?? 1)) });
  }
  return { keyboard, overlap, synthBlack, synthForChannel: (ch) => synthByChannel[ch] };
}

/**
 * Renders the full frame. Keyboard + Synthesia on the same note -> overlap color;
 * otherwise keyboard color > synthesia (per channel) > off.
 * When several Synthesia channels hold the same note, the lowest channel number wins.
 */
function renderFrame(store, mapper, palette) {
  const pixels = Buffer.alloc(FRAME_BYTES);
  const cells = new Array(LED_COUNT).fill(null);

  for (const [note, channels] of store.litNotes('synthesia')) {
    const led = mapper.ledForNote(note);
    if (led === null) continue;
    const color = BLACK_PITCH_CLASSES.has(note % 12) ? palette.synthBlack : palette.synthForChannel(channels[0]);
    if (!cells[led] || cells[led].channel > channels[0]) cells[led] = { ...color, channel: channels[0] };
  }
  for (const note of store.litNotes('keyboard').keys()) {
    const led = mapper.ledForNote(note);
    if (led === null) continue;
    cells[led] = { ...(cells[led] ? palette.overlap : palette.keyboard), channel: -1 };
  }

  for (let i = 0; i < LED_COUNT; i++) {
    const c = cells[i];
    if (!c) continue;
    pixels[i * 3] = c.rgb[0];
    pixels[i * 3 + 1] = c.rgb[1];
    pixels[i * 3 + 2] = c.rgb[2];
  }
  return { pixels, cells };
}

/** One character per LED: '.' off, 'W' keyboard, 'O' overlap, 'S'/'G'/'B'... Synthesia colors, 'K' Synthesia black keys. */
function cellsToString(cells) {
  return cells.map((c) => (c ? c.symbol : '.')).join('');
}

module.exports = { createPalette, renderFrame, cellsToString, scale };
