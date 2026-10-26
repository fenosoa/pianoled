/**
 * Horloge externe qui fournit le temps au KaraokeRenderer.
 * Remplaçable (ex. horloge pilotée par WebSocket) : il suffit d'implémenter cette interface.
 * Chaque `onXxx` retourne une fonction de désinscription.
 */
export interface Clock {
  /** position courante en secondes (interpolée pour rester fluide à 60 fps) */
  now(): number;
  isPlaying(): boolean;
  onPlay(cb: () => void): () => void;
  onPause(cb: () => void): () => void;
  onSeek(cb: (time: number) => void): () => void;
}

/** Horloge basée sur un élément <audio> ou <video>. */
export class AudioElementClock implements Clock {
  private lastRaw = -1;
  private lastPerf = 0;

  constructor(private el: HTMLMediaElement) {}

  now(): number {
    const raw = this.el.currentTime;
    const perf = performance.now();
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.lastPerf = perf;
    }
    if (this.el.paused || this.el.ended) return raw;
    // currentTime n'avance parfois que par pas de ~250 ms (Firefox, Safari) : on interpole,
    // en plafonnant pour ne jamais dériver loin de la vraie position.
    const dt = Math.min((perf - this.lastPerf) / 1000, 0.25);
    return raw + dt * this.el.playbackRate;
  }

  isPlaying(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  private on(ev: string, cb: () => void): () => void {
    this.el.addEventListener(ev, cb);
    return () => this.el.removeEventListener(ev, cb);
  }

  onPlay(cb: () => void) {
    return this.on('play', cb);
  }
  onPause(cb: () => void) {
    return this.on('pause', cb);
  }
  onSeek(cb: (time: number) => void) {
    return this.on('seeked', () => cb(this.el.currentTime));
  }
}

/** Horloge manuelle (aperçu figé, tests, futur aperçu de l'éditeur). */
export class ManualClock implements Clock {
  private t = 0;
  private playing = false;
  private cbs = { play: new Set<() => void>(), pause: new Set<() => void>(), seek: new Set<(t: number) => void>() };

  now() {
    return this.t;
  }
  isPlaying() {
    return this.playing;
  }
  set(t: number) {
    this.t = t;
    this.cbs.seek.forEach((cb) => cb(t));
  }
  onPlay(cb: () => void) {
    this.cbs.play.add(cb);
    return () => void this.cbs.play.delete(cb);
  }
  onPause(cb: () => void) {
    this.cbs.pause.add(cb);
    return () => void this.cbs.pause.delete(cb);
  }
  onSeek(cb: (t: number) => void) {
    this.cbs.seek.add(cb);
    return () => void this.cbs.seek.delete(cb);
  }
}
