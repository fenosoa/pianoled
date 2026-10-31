import './style.css';
import { cleanLabel } from './karaoke/label';
import { mountPlayerPage } from './pages/playerPage';
import { mountSyncPage } from './pages/syncPage';

const app = document.getElementById('app')!;
let dispose: (() => void) | null = null;

/** Routeur minimal par hash : #/ (liste), #/sync (piloté par le lecteur d'accords) et #/play/<id>[?preview=12.5]. */
async function route(): Promise<void> {
  dispose?.();
  dispose = null;
  const [path, query = ''] = location.hash.slice(1).split('?');
  if (path === '/sync') {
    dispose = mountSyncPage(app, new URLSearchParams(query));
    return;
  }
  const m = path.match(/^\/play\/(\w+)$/);
  if (m) {
    dispose = await mountPlayerPage(app, m[1], new URLSearchParams(query));
    return;
  }
  await mountHome();
}

async function mountHome(): Promise<void> {
  app.innerHTML = '<main class="home"><h1>🎤 Karaoke Studio</h1><p><a href="#/sync">📡 Suivre le lecteur d’accords</a></p><ul id="songs">Chargement…</ul></main>';
  const ul = document.getElementById('songs')!;
  try {
    const songs: { id: string; title: string; artist: string; status: string }[] = await (await fetch('/api/songs')).json();
    ul.innerHTML = songs.length
      ? songs.map((s) => `<li><a href="#/play/${s.id}">${cleanLabel(s.title)}${s.artist ? ' — ' + cleanLabel(s.artist) : ''}</a></li>`).join('')
      : '<li>Aucune chanson pour le moment.</li>';
  } catch {
    ul.innerHTML = '<li>API injoignable (le moteur Python tourne-t-il sur le port 8000 ?)</li>';
  }
}

window.addEventListener('hashchange', route);
route();
