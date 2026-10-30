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

export interface SyncSong {
  name: string;
  title: string;
  lyrics: import('./types').LyricsJson | null;
}

/**
 * Horloge pilotée par WebSocket : le lecteur d'accords (maître, web_chords_karaoke) joue l'audio et
 * diffuse chanson + { playing, time, rate } à chaque événement et chaque seconde ; ici on interpole entre deux messages.
 */
export class WebSocketClock implements Clock {
  private ws: WebSocket | null = null;
  private timer = 0;
  private closed = false;
  private t = 0;
  private at = 0;
  private playing = false;
  private rate = 1;
  private cbs = { play: new Set<() => void>(), pause: new Set<() => void>(), seek: new Set<(t: number) => void>() };
  private songCbs = new Set<(s: SyncSong) => void>();
  private statusCbs = new Set<(connected: boolean) => void>();

  constructor(private url: string) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'follower' }));
      this.statusCbs.forEach((cb) => cb(true));
    };
    ws.onclose = () => {
      this.statusCbs.forEach((cb) => cb(false));
      this.timer = window.setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === 'song') this.songCbs.forEach((cb) => cb(m));
      else if (m.type === 'state') this.apply(m);
    };
  }

  private apply(m: { playing: boolean; time: number; rate?: number }): void {
    const predicted = this.now();
    const wasPlaying = this.playing;
    this.t = m.time;
    this.at = performance.now();
    this.playing = m.playing;
    this.rate = m.rate || 1;
    if (m.playing && !wasPlaying) this.cbs.play.forEach((cb) => cb());
    else if (!m.playing && wasPlaying) this.cbs.pause.forEach((cb) => cb());
    // saut franc (seek, boucle) ; les petits écarts des battements sont absorbés par l'interpolation
    if (Math.abs(m.time - predicted) > 0.5) this.cbs.seek.forEach((cb) => cb(m.time));
  }

  now(): number {
    return this.playing ? this.t + ((performance.now() - this.at) / 1000) * this.rate : this.t;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  onSong(cb: (s: SyncSong) => void) {
    this.songCbs.add(cb);
    return () => void this.songCbs.delete(cb);
  }
  onStatus(cb: (connected: boolean) => void) {
    this.statusCbs.add(cb);
    return () => void this.statusCbs.delete(cb);
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
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}
