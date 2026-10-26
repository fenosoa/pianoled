/** Écran 3 : lecteur karaoké plein écran (tablette). Assemble Clock + KaraokeRenderer + contrôles. */
import { AudioElementClock, ManualClock, type Clock } from '../karaoke/clock';
import { KaraokeRenderer } from '../karaoke/KaraokeRenderer';
import { runRenderLoop } from '../karaoke/loop';
import type { LyricsJson } from '../karaoke/types';

const IDLE_MS = 3000;

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
}

/**
 * `?preview=SECONDES` : aperçu figé à cet instant, sans audio (test visuel du rendu).
 * Retourne la fonction de nettoyage appelée au changement de page.
 */
export async function mountPlayerPage(host: HTMLElement, songId: string, params: URLSearchParams): Promise<() => void> {
  const res = await fetch(`/api/songs/${songId}`);
  if (!res.ok) {
    host.textContent = 'Chanson introuvable.';
    return () => {};
  }
  const song: { title: string; artist: string; lyrics: LyricsJson | null } = await res.json();
  if (!song.lyrics) {
    host.textContent = 'Alignement non terminé.';
    return () => {};
  }

  host.innerHTML = `
    <div class="player">
      <div class="stage-host"></div>
      <div class="topbar"><button data-a="back" title="Retour">←</button><button data-a="fs" title="Plein écran">⛶</button></div>
      <div class="controls">
        <button data-a="play">▶</button>
        <input type="range" min="0" max="1" step="0.01" value="0" />
        <span class="time">0:00</span>
      </div>
    </div>`;
  const player = host.querySelector<HTMLElement>('.player')!;
  const renderer = new KaraokeRenderer();
  renderer.mount(player.querySelector('.stage-host')!);
  renderer.setMeta({ title: song.title, artist: song.artist });
  renderer.load(song.lyrics);

  const playBtn = player.querySelector<HTMLButtonElement>('[data-a=play]')!;
  const seek = player.querySelector<HTMLInputElement>('input[type=range]')!;
  const timeEl = player.querySelector<HTMLElement>('.time')!;
  const cleanups: (() => void)[] = [];

  let clock: Clock;
  let audio: HTMLAudioElement | null = null;
  const preview = params.get('preview');
  if (preview !== null) {
    const mc = new ManualClock();
    mc.set(parseFloat(preview));
    clock = mc;
    renderer.setInstant(true);
    player.querySelector('.controls')!.remove();
  } else {
    audio = new Audio(`/api/songs/${songId}/audio`);
    audio.preload = 'auto';
    clock = new AudioElementClock(audio);
    const overlay = document.createElement('div');
    overlay.className = 'start-overlay';
    overlay.innerHTML = '<button>▶ Lancer</button>';
    player.appendChild(overlay);
    overlay.querySelector('button')!.addEventListener('click', () => { overlay.remove(); audio!.play(); });

    const toggle = () => (audio!.paused ? audio!.play() : audio!.pause());
    playBtn.addEventListener('click', toggle);
    cleanups.push(clock.onPlay(() => (playBtn.textContent = '⏸')), clock.onPause(() => (playBtn.textContent = '▶')));
    audio.addEventListener('loadedmetadata', () => (seek.max = String(audio!.duration)));
    seek.addEventListener('input', () => (audio!.currentTime = parseFloat(seek.value)));
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); toggle(); } };
    window.addEventListener('keydown', onKey);
    cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  const stop = runRenderLoop(renderer, clock);
  const uiTimer = window.setInterval(() => {
    if (!audio) return;
    timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration || 0)}`;
    if (document.activeElement !== seek) seek.value = String(audio.currentTime);
  }, 250);

  // Contrôles discrets : disparaissent après 3 s d'inactivité.
  let idleTimer = 0;
  const wake = () => {
    player.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => player.classList.add('idle'), IDLE_MS);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, wake);
  wake();

  player.querySelector('[data-a=back]')!.addEventListener('click', () => (location.hash = '#/'));
  player.querySelector('[data-a=fs]')!.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else player.requestFullscreen?.();
  });

  return () => {
    stop();
    audio?.pause();
    clearInterval(uiTimer);
    clearTimeout(idleTimer);
    for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.removeEventListener(ev, wake);
    cleanups.forEach((c) => c());
  };
}
