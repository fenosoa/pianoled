import React from 'react';
import { createRoot } from 'react-dom/client';
import VideoPlayer from './g-video-player.component.jsx';
import './styles.css';

// --- PAROLES (facultatives) : <chanson>/<nom>.lyrics.json dans piano_stems_output (voir vite.config.js) ;
// repli sur media/<nom>.lyrics.json ---
const lyricFiles = import.meta.glob('../media/*.lyrics.json', { query: '?url', import: 'default', eager: true });
const lyricsByName = {};
for (const [path, url] of Object.entries(lyricFiles)) {
  lyricsByName[path.match(/\/([^/]+)\.lyrics\.json$/)[1]] = url;
}

// Les accords sont toujours dans l'objet "chords" du JSON (chaîne "beat;accord;start;end\n...")
const findChords = (node) => {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.chords === 'string') return node;
  for (const child of Object.values(node)) {
    const found = findChords(child);
    if (found) return found;
  }
  return null;
};

const normalizeTimeline = (data) => {
  const holder = findChords(data);
  if (!holder) return data; // déjà au format { bpm, key_signature, timeline }
  const info = holder.chordInfo ?? {};
  return {
    bpm: info.derivedBpm,
    key_signature: info.derivedKey,
    original_key: info.originalKey,
    transpose_up: info.transposeUp,
    transpose_down: info.transposeDown,
    timeline: holder.chords,
  };
};

// Usage : ?song=<sous-répertoire de G:\piano_stems_output> (défaut : première chanson)
// Surcharges possibles : ?timeline=...&media=... (ou video= / audio=) &poster=...
const params = new URLSearchParams(window.location.search);
const hasOverride = ['timeline', 'media', 'video', 'audio'].some((k) => params.has(k));

function App() {
  const [library, setLibrary] = React.useState(null); // toutes les chansons (pistes, accords, paroles)
  const [queue, setQueue] = React.useState(null); // noms ordonnés (page /playlist.html) ; null = toute la bibliothèque
  const [timelineData, setTimelineData] = React.useState(null);
  const [lyricsData, setLyricsData] = React.useState(null);
  const [songName, setSongName] = React.useState(null);

  // Chansons = sous-répertoires de STEMS_DIR (voir vite.config.js) ; ordre = file de lecture partagée
  React.useEffect(() => {
    Promise.all([
      fetch('/stems/index.json').then((r) => r.json()),
      fetch('/playlist/api').then((r) => r.json()).catch(() => null),
    ])
      .then(([list, shared]) => {
        const names = shared?.queue ?? list.map((s) => s.name);
        setLibrary(list);
        setQueue(names);
        setSongName(names.includes(params.get('song')) ? params.get('song') : names[0] ?? list[0]?.name ?? null);
      })
      .catch((e) => {
        console.error('Stems introuvables', e);
        setLibrary([]);
      });
  }, []);

  const playlist = React.useMemo(() => {
    const byName = new Map((library ?? []).map((s) => [s.name, s]));
    return (queue ?? []).map((n) => byName.get(n)).filter(Boolean);
  }, [library, queue]);

  // La chanson en cours reste jouée même si on la retire de la file
  const song = (library ?? []).find((s) => s.name === songName) ?? {};
  const timelineUrl = params.get('timeline') || song.json || '/timeline.json';

  React.useEffect(() => {
    if (!library) return;
    let cancelled = false;
    setTimelineData(null); // évite d'afficher les accords de la chanson précédente
    fetch(timelineUrl)
      .then((r) => r.json())
      .then((d) => !cancelled && setTimelineData(normalizeTimeline(d)))
      .catch((e) => console.error('Timeline introuvable', e));
    return () => {
      cancelled = true;
    };
  }, [timelineUrl, library]);

  const lyricsUrl = params.get('lyrics') || song.lyrics || lyricsByName[song.name];
  React.useEffect(() => {
    let cancelled = false;
    setLyricsData(null);
    if (!lyricsUrl) return;
    fetch(lyricsUrl)
      .then((r) => r.json())
      .then((d) => !cancelled && setLyricsData(d))
      .catch((e) => console.error('Paroles introuvables', e));
    return () => {
      cancelled = true;
    };
  }, [lyricsUrl]);

  const select = (name) => {
    setSongName(name);
    const url = new URL(window.location.href);
    url.searchParams.set('song', name);
    window.history.replaceState(null, '', url);
  };

  const goTo = (delta) => {
    const i = playlist.findIndex((s) => s.name === songName);
    const next = i < 0 ? (delta > 0 ? 0 : playlist.length - 1) : (i + delta + playlist.length) % playlist.length;
    select(playlist[next].name);
  };

  const override = params.get('media') || params.get('video') || params.get('audio');
  const videoMeta = override
    ? { hlsUrl: override, posterUrl: params.get('poster') }
    : song.tracks && { tracks: song.tracks, posterUrl: params.get('poster') };
  const canNavigate = playlist.length > 1 && !hasOverride;

  if (!library) return null;
  return (
    <VideoPlayer
      videoMeta={videoMeta}
      timelineData={timelineData}
      lyricsData={lyricsData}
      songTitle={song.title}
      songId={song.name}
      onQueue={setQueue}
      onSelect={hasOverride ? undefined : select}
      onPrevious={canNavigate ? () => goTo(-1) : undefined}
      onNext={canNavigate ? () => goTo(1) : undefined}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
