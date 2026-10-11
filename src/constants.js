'use strict';

// LED_COUNT is deliberately not configurable during this phase: only LEDs 0..79 are validated.
const LED_COUNT = 80;
const BYTES_PER_PIXEL = 3;

module.exports = Object.freeze({
  LED_COUNT,
  BYTES_PER_PIXEL,
  FRAME_BYTES: LED_COUNT * BYTES_PER_PIXEL,
  DDP_DEFAULT_PORT: 4048,
  SOURCES: Object.freeze(['keyboard', 'synthesia']),
});
