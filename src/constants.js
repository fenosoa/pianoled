'use strict';

// LED_COUNT is deliberately not configurable: the piano strip has 119 LEDs (indices 0..118).
const LED_COUNT = 119;
const BYTES_PER_PIXEL = 3;

module.exports = Object.freeze({
  LED_COUNT,
  BYTES_PER_PIXEL,
  FRAME_BYTES: LED_COUNT * BYTES_PER_PIXEL,
  DDP_DEFAULT_PORT: 4048,
  SOURCES: Object.freeze(['keyboard', 'synthesia']),
});
