/**
 * KaraokeRenderer : rendu pur, indépendant de la source audio.
 * Il ne lit jamais l'audio : l'hôte appelle `render(t)` avec le temps fourni par une Clock.
 *
 *   const r = new KaraokeRenderer(); r.mount(el); r.load(json); r.render(12.3);
 *   const stop = runRenderLoop(r, clock);   // boucle requestAnimationFrame (voir loop.ts)
 */
import './karaoke.css';
import { computeState, DEFAULT_CORE, flatten, wordProgress, type CoreOptions, type DisplayState, type FlatLine } from './core';
import { DEFAULT_THEME, mergeTheme, type Theme } from './themes';
import type { LyricsJson, SectionType } from './types';

type Slot = 'cur' | 'next' | 'out' | 'enter';

interface LineEl {
  idx: number;
  el: HTMLElement;
  fills: HTMLElement[];
  last: number[];
  slot: Slot;
  removeTimer?: number;
}

export class KaraokeRenderer {
  private root!: HTMLElement;
  private linesBox!: HTMLElement;
  private dots!: HTMLElement;
  private idle!: HTMLElement;
  private idleTitle!: HTMLElement;
  private idleArtist!: HTMLElement;
  private fxBox!: HTMLElement;
  private fxVideos = new Map<SectionType, HTMLVideoElement>();

  private lines: FlatLine[] = [];
  private offset = 0;
  private theme: Theme = DEFAULT_THEME;
  private core: CoreOptions = DEFAULT_CORE;
  private els = new Map<number, LineEl>();
  private shownType: SectionType | null = null;
  private shownCount = -1;
  private shownIdle: boolean | null = null;

  /** Insère le DOM du lecteur dans `element` (qui doit avoir une taille, ex. plein écran). */
  mount(element: HTMLElement): void {
    element.innerHTML = '';
    this.root = document.createElement('div');
    this.root.className = 'kr-stage';
    this.root.innerHTML = `
      <div class="kr-bg"></div><div class="kr-fx"></div><div class="kr-glow"></div>
      <div class="kr-idle"><div class="kr-eq"><i></i><i></i><i></i><i></i><i></i></div>
        <div class="kr-title"></div><div class="kr-artist"></div></div>
      <div class="kr-dots"><i></i><i></i><i></i></div>
      <div class="kr-lines"></div>`;
    element.appendChild(this.root);
    this.fxBox = this.root.querySelector('.kr-fx')!;
    this.linesBox = this.root.querySelector('.kr-lines')!;
    this.dots = this.root.querySelector('.kr-dots')!;
    this.idle = this.root.querySelector('.kr-idle')!;
    this.idleTitle = this.root.querySelector('.kr-title')!;
    this.idleArtist = this.root.querySelector('.kr-artist')!;
    this.applyTheme();
    this.setType('intro');
  }

  /** Charge un lyrics.json ; réinitialise l'affichage. */
  load(lyrics: LyricsJson): void {
    this.lines = flatten(lyrics);
    this.offset = lyrics.offset ?? 0;
    this.clearLines();
    this.shownCount = -1;
    this.shownIdle = null;
  }

  /** Titre/artiste affichés pendant les passages instrumentaux. */
  setMeta(meta: { title?: string; artist?: string }): void {
    this.idleTitle.textContent = meta.title ?? '';
    this.idleArtist.textContent = meta.artist ?? '';
  }

  setTheme(theme: Partial<Theme>): void {
    this.theme = mergeTheme(this.theme, theme);
    this.applyTheme();
    this.shownType = null;
  }

  /** Désactive les transitions CSS (aperçus figés, captures). */
  setInstant(on: boolean): void {
    this.root.classList.toggle('kr-instant', on);
  }

  setOffset(seconds: number): void {
    this.offset = seconds;
  }

  setCoreOptions(o: Partial<CoreOptions>): void {
    this.core = { ...this.core, ...o };
  }

  /** Dessine l'état correspondant à `currentTimeSeconds` (idempotent, appelable à chaque frame). */
  render(currentTimeSeconds: number): void {
    if (!this.root) return;
    const t = currentTimeSeconds - this.offset;
    const st = computeState(this.lines, t, this.core);
    const shown = this.displayedIdx(st);

    this.setType(this.typeFor(st));
    this.setIdle(st.kind === 'wait' && st.count === 0);
    this.setDots(st.kind === 'wait' ? st.count : 0);
    this.layout(shown);
    for (const le of this.els.values()) this.paint(le, t);
  }

  // --- interne -------------------------------------------------------------------------

  /** Index de la ligne « grande » affichée (null = aucune, écran d'attente). */
  private displayedIdx(st: DisplayState): number | null {
    if (st.kind === 'sing') return st.idx;
    return st.count > 0 && st.next >= 0 ? st.next : null; // pendant le compte à rebours, on montre la reprise
  }

  private typeFor(st: DisplayState): SectionType {
    const i = st.kind === 'sing' ? st.idx : st.next;
    return i >= 0 && this.lines[i] ? this.lines[i].type : 'intro';
  }

  private setType(type: SectionType): void {
    if (type === this.shownType) return;
    this.shownType = type;
    this.root.dataset.type = type;
    this.showFx(type);
  }

  /** Une vidéo par type de section ; seule la vidéo visible est décodée (les autres sont en pause). */
  private showFx(type: SectionType): void {
    for (const [t, v] of this.fxVideos) {
      if (t === type) continue;
      v.classList.remove('on');
      window.setTimeout(() => { if (!v.classList.contains('on')) v.pause(); }, 1600); // après le fondu
    }
    const src = this.theme.fx[type];
    if (!src) return;
    let v = this.fxVideos.get(type);
    if (!v) {
      v = document.createElement('video');
      v.src = src;
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      v.addEventListener('error', () => v!.remove()); // fichier absent : on garde le dégradé seul
      this.fxBox.appendChild(v);
      this.fxVideos.set(type, v);
    }
    v.classList.add('on');
    v.play().catch(() => {});
  }

  private setIdle(on: boolean): void {
    if (on === this.shownIdle) return;
    this.shownIdle = on;
    this.idle.classList.toggle('on', on);
  }

  private setDots(n: number): void {
    if (n === this.shownCount) return;
    this.shownCount = n;
    this.dots.classList.toggle('on', n > 0);
    [...this.dots.children].forEach((d, i) => d.classList.toggle('lit', i < n));
  }

  private clearLines(): void {
    for (const le of this.els.values()) le.el.remove();
    this.els.clear();
  }

  private ensure(idx: number): LineEl {
    let le = this.els.get(idx);
    if (le) {
      if (le.removeTimer) { clearTimeout(le.removeTimer); le.removeTimer = undefined; }
      return le;
    }
    const line = this.lines[idx];
    const el = document.createElement('div');
    el.className = 'kr-line enter';
    const chars = line.words.reduce((n, w) => n + w.t.length + 1, 0);
    el.style.setProperty('--fit', chars <= 17 ? '1' : chars <= 26 ? '0.82' : chars <= 40 ? '0.68' : '0.55');
    const fills: HTMLElement[] = [];
    line.words.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'kr-w';
      const base = document.createElement('span');
      base.className = 'kr-b';
      base.textContent = w.t;
      const fill = document.createElement('span');
      fill.className = 'kr-f';
      fill.textContent = w.t;
      fill.setAttribute('aria-hidden', 'true');
      span.append(base, fill);
      el.append(span);
      if (i < line.words.length - 1) el.append(' ');
      fills.push(fill);
    });
    this.linesBox.appendChild(el);
    el.getBoundingClientRect(); // force le style initial (.enter) avant la transition
    le = { idx, el, fills, last: fills.map(() => -1), slot: 'enter' };
    this.els.set(idx, le);
    return le;
  }

  /** Place chaque ligne dans son emplacement (cur / next / out) ; supprime les autres. */
  private layout(shown: number | null): void {
    const want = new Map<number, Slot>();
    if (shown !== null) {
      want.set(shown, 'cur');
      if (shown + 1 < this.lines.length) want.set(shown + 1, 'next');
      if (shown - 1 >= 0) want.set(shown - 1, 'out');
    } else {
      for (const [idx, le] of this.els) if (le.slot === 'cur' || le.slot === 'next') want.set(idx, 'out');
    }
    for (const [idx, slot] of want) {
      const le = this.ensure(idx);
      // une ligne « out » inexistante n'a pas besoin d'être créée (saut, seek)
      if (le.slot !== slot) {
        le.slot = slot;
        le.el.className = `kr-line ${slot}`;
      }
    }
    for (const [idx, le] of this.els) {
      if (!want.has(idx) && !le.removeTimer && le.slot !== 'out') {
        le.slot = 'out';
        le.el.className = 'kr-line out';
      }
      if (!want.has(idx) && !le.removeTimer) {
        le.removeTimer = window.setTimeout(() => { le.el.remove(); this.els.delete(idx); }, 700);
      }
    }
  }

  private paint(le: LineEl, t: number): void {
    const line = this.lines[le.idx];
    for (let i = 0; i < line.words.length; i++) {
      const p = wordProgress(line.words[i], t);
      if (Math.abs(p - le.last[i]) < 0.002 && le.last[i] !== -1) continue;
      le.last[i] = p;
      le.fills[i].style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)`;
    }
  }

  private applyTheme(): void {
    const s = this.root.style;
    for (const [type, p] of Object.entries(this.theme.palettes)) {
      s.setProperty(`--${type}-c1`, p.bg[0]);
      s.setProperty(`--${type}-c2`, p.bg[1]);
      s.setProperty(`--${type}-c3`, p.bg[2]);
      s.setProperty(`--${type}-fill`, p.fill);
    }
    s.setProperty('--base', this.theme.base);
    s.setProperty('--outline', this.theme.outline);
    s.setProperty('--font', this.theme.fontFamily);
  }
}
