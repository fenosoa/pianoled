/** Mode suiveur : le lecteur d'accords (web_chords_karaoke) pilote chanson et timeline par WebSocket. */
import { WebSocketClock } from '../karaoke/clock';
import { KaraokeRenderer } from '../karaoke/KaraokeRenderer';
import { runRenderLoop } from '../karaoke/loop';

const STORE_KEY = 'syncHost';
const IDLE_MS = 3000;

/** Hôte du maître : ?sync=host:port (mémorisé), sinon le serveur d'accords sur cette machine (port 5180). */
function syncUrl(params: URLSearchParams): string {
  let host = params.get('sync');
  try {
    if (host) localStorage.setItem(STORE_KEY, host);
    else host = localStorage.getItem(STORE_KEY);
  } catch { /* stockage indisponible */ }
  host ||= `${location.hostname}:5180`;
  return `ws://${host}/sync`;
}

export function mountSyncPage(host: HTMLElement, params: URLSearchParams): () => void {
  host.innerHTML = `
    <div class="player">
      <div class="stage-host"></div>
      <div class="topbar"><button data-a="back" title="Retour">←</button><span class="sync-status">Connexion…</span><button data-a="fs" title="Plein écran">⛶</button></div>
    </div>`;
  const player = host.querySelector<HTMLElement>('.player')!;
  const status = player.querySelector<HTMLElement>('.sync-status')!;
  const renderer = new KaraokeRenderer();
  renderer.mount(player.querySelector('.stage-host')!);

  const clock = new WebSocketClock(syncUrl(params));
  let hasSong = false;
  let connected = false;
  const refresh = () => {
    status.textContent = !connected ? 'Lecteur d’accords injoignable…' : hasSong ? '' : 'En attente d’une chanson avec paroles…';
  };
  const offs = [
    clock.onStatus((c) => { connected = c; refresh(); }),
    clock.onSong((s) => {
      hasSong = !!s.lyrics;
      if (s.lyrics) {
        renderer.setMeta({ title: s.title, artist: '' });
        renderer.load(s.lyrics);
      }
      refresh();
    }),
  ];
  const stop = runRenderLoop(renderer, clock);

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
    clock.close();
    offs.forEach((o) => o());
    clearTimeout(idleTimer);
    for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.removeEventListener(ev, wake);
  };
}
