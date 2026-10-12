'use strict';

// LED_COUNT is deliberately not configurable: the piano strip uses 120 LEDs (indices 0..119).
const LED_COUNT = 120;
const BYTES_PER_PIXEL = 3;

module.exports = Object.freeze({
  LED_COUNT,
  BYTES_PER_PIXEL,
  FRAME_BYTES: LED_COUNT * BYTES_PER_PIXEL,
  DDP_DEFAULT_PORT: 4048,
  SOURCES: Object.freeze(['keyboard', 'synthesia']),
});
