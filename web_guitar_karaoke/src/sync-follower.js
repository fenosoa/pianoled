// Suiveur en lecture seule : se déclare 'follower' auprès du hub WebSocket du lecteur d'accords (web_chords_karaoke, /sync)
// et reçoit { type:'song', id, title, lyrics } et { type:'state', playing, time, rate }. Aucune commande n'est envoyée.
// Entre deux messages d'état (1 par seconde en lecture), le temps est interpolé.
const RETRY_MS = 2000;
const STORE_KEY = 'syncHost';

// Hôte du maître : ?sync=host:port (mémorisé), sinon le serveur d'accords de cette machine (port 5180)
export const resolveHost = () => {
  let host = new URLSearchParams(location.search).get('sync');
  try {
    if (host) localStorage.setItem(STORE_KEY, host);
    else host = localStorage.getItem(STORE_KEY);
  } catch {
    /* stockage indisponible */
  }
  return host || `${location.hostname}:5180`;
};

export function createFollower(host, { onSong, onStatus }) {
  let ws = null;
  let closed = false;
  let timer = 0;
  let t = 0;
  let at = 0;
  let playing = false;
  let rate = 1;

  const now = () => (playing ? t + ((performance.now() - at) / 1000) * rate : t);

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`ws://${host}/sync`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'follower' }));
      onStatus(true);
    };
    ws.onclose = () => {
      onStatus(false);
      timer = setTimeout(connect, RETRY_MS);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'song') onSong(m);
      else if (m.type === 'state') {
        t = m.time;
        at = performance.now();
        playing = !!m.playing;
        rate = m.rate || 1;
      }
    };
  };
  connect();

  return {
    now,
    isPlaying: () => playing,
    close: () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
