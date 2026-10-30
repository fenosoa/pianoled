// Côté maître : diffuse la chanson (paroles) et l'état de lecture au hub WebSocket du serveur Vite
// (/sync, voir vite.config.js). Reconnexion automatique ; le dernier état est renvoyé à chaque (re)connexion.
const RETRY_MS = 2000;

export function createSyncMaster(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`) {
  let ws = null;
  let closed = false;
  let timer = 0;
  const last = { song: null, state: null };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'master' }));
      if (last.song) ws.send(last.song);
      if (last.state) ws.send(last.state);
    };
    ws.onclose = () => {
      timer = setTimeout(open, RETRY_MS);
    };
    ws.onerror = () => ws.close();
  };
  open();

  const send = (msg) => {
    const data = JSON.stringify(msg);
    last[msg.type] = data;
    if (ws?.readyState === 1) ws.send(data);
  };

  return {
    sendSong: (name, title, lyrics) => send({ type: 'song', name, title, lyrics }),
    sendState: (video) =>
      send({ type: 'state', playing: !video.paused && !video.ended, time: video.currentTime, rate: video.playbackRate }),
    close: () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
