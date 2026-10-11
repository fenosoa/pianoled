'use strict';

function monotonicMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

/** Bounded sample store (ring buffer) with percentile summary. */
class SampleStats {
  constructor(capacity = 20000) {
    this.capacity = capacity;
    this.samples = [];
    this.next = 0;
    this.total = 0;
  }

  add(value) {
    if (this.samples.length < this.capacity) this.samples.push(value);
    else {
      this.samples[this.next] = value;
      this.next = (this.next + 1) % this.capacity;
    }
    this.total++;
  }

  reset() {
    this.samples = [];
    this.next = 0;
    this.total = 0;
  }

  summary() {
    const n = this.samples.length;
    if (n === 0) return { count: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return {
      count: this.total,
      min: sorted[0],
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      max: sorted[n - 1],
      mean,
      stdev: Math.sqrt(variance),
    };
  }
}

function fmtStats(s, unit = 'ms') {
  if (!s || !s.count) return 'n/a';
  const f = (v) => v.toFixed(2);
  return `n=${s.count} min=${f(s.min)} p50=${f(s.p50)} p95=${f(s.p95)} p99=${f(s.p99)} max=${f(s.max)} mean=${f(s.mean)} sd=${f(s.stdev)} ${unit}`;
}

module.exports = { monotonicMs, SampleStats, fmtStats };
