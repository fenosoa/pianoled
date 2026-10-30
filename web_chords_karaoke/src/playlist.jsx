import React from 'react';
import { createRoot } from 'react-dom/client';
import './playlist.css';

// Page de gestion de la file de lecture (à ouvrir sur un autre écran que le lecteur d'accords).
// API : voir playlist-server.js. L'état est relu toutes les 2 s : plusieurs écrans peuvent éditer en même temps.
const POLL_MS = 2000;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function App() {
  const [state, setState] = React.useState({ library: [], queue: [], current: null });
  const [search, setSearch] = React.useState('');
  const [dragName, setDragName] = React.useState(null);
  const [overName, setOverName] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const busy = React.useRef(false); // pas de relecture pendant un glisser-déposer ou une requête

  const refresh = React.useCallback(() => {
    if (busy.current) return;
    fetch('/playlist/api')
      .then((r) => r.json())
      .then(setState)
      .catch(() => setNotice('Serveur injoignable'));
  }, []);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const call = async (action, body, method = 'POST') => {
    busy.current = true;
    try {
      const r = await fetch(`/playlist/api/${action}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.ok) return setNotice(data.error || 'Erreur');
      setState(data);
      setNotice(action === 'play' && data.played === false ? 'Aucun lecteur connecté' : '');
    } catch {
      setNotice('Serveur injoignable');
    } finally {
      busy.current = false;
    }
  };

  const titles = React.useMemo(() => new Map(state.library.map((s) => [s.name, s.title])), [state.library]);
  const [onlyKeyChanges, setOnlyKeyChanges] = React.useState(false);
  const results = React.useMemo(() => {
    const q = norm(search.trim());
    return state.library.filter(
      (s) => (!onlyKeyChanges || s.keyChanges?.length) && (!q || norm(s.title).includes(q) || norm(s.name).includes(q))
    );
  }, [state.library, search, onlyKeyChanges]);
  const keyBadge = (s) =>
    s?.keyChanges?.length > 0 && (
      <span className="pl-key" title="Changement(s) de tonalité">♯ {s.keyChanges.map((k) => k.transpose).join(' · ')}</span>
    );
  const songs = React.useMemo(() => new Map(state.library.map((s) => [s.name, s])), [state.library]);

  const setQueue = (queue) => call('queue', { queue }, 'PUT');
  const move = (from, to) => {
    if (to < 0 || to >= state.queue.length || from === to) return;
    const q = [...state.queue];
    q.splice(to, 0, q.splice(from, 1)[0]);
    setQueue(q);
  };
  const onDrop = (name) => {
    const from = state.queue.indexOf(dragName);
    if (from >= 0) move(from, state.queue.indexOf(name));
    setDragName(null);
    setOverName(null);
  };

  return (
    <div className="pl">
      <section className="pl-col">
        <h2>File de lecture <span className="pl-count">{state.queue.length}</span></h2>
        {notice && <p className="pl-notice">{notice}</p>}
        <ul className="pl-list">
          {state.queue.map((name, i) => (
            <li
              key={name}
              className={`pl-item ${name === state.current ? 'current' : ''} ${name === overName ? 'over' : ''}`}
              draggable
              onDragStart={() => { busy.current = true; setDragName(name); }}
              onDragOver={(e) => { e.preventDefault(); setOverName(name); }}
              onDrop={(e) => { e.preventDefault(); onDrop(name); }}
              onDragEnd={() => { busy.current = false; setDragName(null); setOverName(null); }}
            >
              <span className="pl-grip" aria-hidden>⠿</span>
              <span className="pl-title">{titles.get(name) ?? name}</span>
              {keyBadge(songs.get(name))}
              <button onClick={() => call('play', { name })} title="Lire maintenant">▶</button>
              <button onClick={() => move(i, i - 1)} disabled={i === 0} title="Monter">▲</button>
              <button onClick={() => move(i, i + 1)} disabled={i === state.queue.length - 1} title="Descendre">▼</button>
              <button onClick={() => call('remove', { name })} title="Retirer de la file">✕</button>
            </li>
          ))}
          {state.queue.length === 0 && <li className="pl-empty">File vide : ajoutez des chansons depuis la bibliothèque.</li>}
        </ul>
      </section>

      <section className="pl-col">
        <h2>Bibliothèque <span className="pl-count">{results.length}</span></h2>
        <input
          className="pl-search"
          type="search"
          placeholder="Rechercher une chanson…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="pl-filter">
          <input type="checkbox" checked={onlyKeyChanges} onChange={(e) => setOnlyKeyChanges(e.target.checked)} />
          Changement de tonalité uniquement
        </label>
        <ul className="pl-list">
          {results.map((s) => (
            <li key={s.name} className={`pl-item ${s.name === state.current ? 'current' : ''}`}>
              <span className="pl-title">{s.title}</span>
              {keyBadge(s)}
              <button onClick={() => call('play', { name: s.name })} title="Lire maintenant">▶ Lire</button>
              <button onClick={() => call('play-next', { name: s.name })} title="Juste après la chanson en cours">⏭ Ensuite</button>
              <button onClick={() => call('add', { name: s.name })} title="À la fin de la file">＋ À la suite</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
