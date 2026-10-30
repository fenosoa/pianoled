import fs from 'node:fs';

// File de lecture partagée : liste ordonnée de noms de chansons (sous-répertoires de STEMS_DIR), persistée dans un
// fichier JSON. La page /playlist.html la modifie via /playlist/api/* ; le lecteur (maître du hub /sync) la reçoit
// ({type:'queue'}) et exécute « lire maintenant » ({type:'command', action:'play', name}).
// Sans fichier, la file = toute la bibliothèque (ordre alphabétique) : comportement d'origine du lecteur.
const API_PREFIX = '/playlist/api';

export function createPlaylistStore({ file, listSongs }) {
  let saved = null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data)) saved = data.filter((n) => typeof n === 'string');
  } catch {
    /* pas de fichier : file par défaut */
  }
  let current = null; // chanson en cours de lecture, signalée par le lecteur

  const queue = () => {
    const names = listSongs().map((s) => s.name);
    return saved ? [...new Set(saved)].filter((n) => names.includes(n)) : names;
  };
  const write = (next) => {
    saved = next;
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  };
  const known = (name) => listSongs().some((s) => s.name === name);

  // Insère `name` juste après la chanson en cours (ou en tête si rien ne joue) ; la déplace si déjà dans la file
  const insertNext = (name) => {
    const q = queue().filter((n) => n !== name);
    const at = q.indexOf(current) + 1; // current absent → 0
    q.splice(at, 0, name);
    write(q);
  };

  return {
    queue,
    get current() {
      return current;
    },
    setCurrent(name) {
      current = typeof name === 'string' ? name : null;
    },
    state: () => ({ library: listSongs().map(({ name, title, keyChanges }) => ({ name, title, keyChanges })), queue: queue(), current }),
    // Retourne true si la file a changé (le hub la renvoie alors au lecteur)
    apply(action, body) {
      const name = body?.name;
      if (action === 'queue') {
        if (!Array.isArray(body?.queue)) return false;
        write(body.queue.filter((n) => typeof n === 'string' && known(n)));
      } else if (!known(name)) {
        return false;
      } else if (action === 'add') {
        write([...queue().filter((n) => n !== name), name]);
      } else if (action === 'play-next') {
        insertNext(name);
      } else if (action === 'play') {
        if (!queue().includes(name)) insertNext(name);
      } else if (action === 'remove') {
        write(queue().filter((n) => n !== name));
      } else {
        return false;
      }
      return true;
    },
  };
}

// Middleware HTTP : GET /playlist/api (état) ; PUT/POST /playlist/api/<queue|add|play-next|play|remove>
export function playlistMiddleware(store, { onChange, playNow }) {
  return (req, res, next) => {
    const url = req.url.split('?')[0].replace(/\/$/, '');
    if (url !== API_PREFIX && !url.startsWith(`${API_PREFIX}/`)) return next();
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && url === API_PREFIX) return send(200, store.state());
    if (req.method !== 'POST' && req.method !== 'PUT') return send(405, { ok: false });

    const action = url.slice(API_PREFIX.length + 1);
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return send(400, { ok: false, error: 'JSON invalide' });
      }
      if (!store.apply(action, body)) return send(400, { ok: false, error: 'requête invalide' });
      onChange(store.queue());
      const played = action === 'play' ? playNow(body.name) : undefined; // false : aucun lecteur connecté
      send(200, { ok: true, played, ...store.state() });
    });
  };
}
