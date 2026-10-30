import React from 'react';
import { createRoot } from 'react-dom/client';
import VideoPlayer from './g-video-player.component.jsx';
import './styles.css';

// --- PAROLES (facultatives) : media/<nom>.lyrics.json, exportées par web_lyrics_karaoke ---
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
  const [playlist, setPlaylist] = React.useState(null);
  const [timelineData, setTimelineData] = React.useState(null);
  const [lyricsData, setLyricsData] = React.useState(null);
  const [songIndex, setSongIndex] = React.useState(0);

  // Chansons = sous-répertoires de STEMS_DIR (voir vite.config.js)
  React.useEffect(() => {
    fetch('/stems/index.json')
      .then((r) => r.json())
      .then((list) => {
        setPlaylist(list);
        setSongIndex(Math.max(0, list.findIndex((s) => s.name === params.get('song'))));
      })
      .catch((e) => {
        console.error('Stems introuvables', e);
        setPlaylist([]);
      });
  }, []);

  const song = playlist?.[songIndex] ?? {};
  const timelineUrl = params.get('timeline') || song.json || '/timeline.json';

  React.useEffect(() => {
    if (!playlist) return;
    let cancelled = false;
    setTimelineData(null); // évite d'afficher les accords de la chanson précédente
    fetch(timelineUrl)
      .then((r) => r.json())
      .then((d) => !cancelled && setTimelineData(normalizeTimeline(d)))
      .catch((e) => console.error('Timeline introuvable', e));
    return () => {
      cancelled = true;
    };
  }, [timelineUrl, playlist]);

  const lyricsUrl = params.get('lyrics') || lyricsByName[song.name];
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

  const goTo = (delta) => {
    const next = (songIndex + delta + playlist.length) % playlist.length;
    setSongIndex(next);
    const url = new URL(window.location.href);
    url.searchParams.set('song', playlist[next].name);
    window.history.replaceState(null, '', url);
  };

  const override = params.get('media') || params.get('video') || params.get('audio');
  const videoMeta = override
    ? { hlsUrl: override, posterUrl: params.get('poster') }
    : song.tracks && { tracks: song.tracks, posterUrl: params.get('poster') };
  const canNavigate = (playlist?.length ?? 0) > 1 && !hasOverride;

  if (!playlist) return null;
  return (
    <VideoPlayer
      videoMeta={videoMeta}
      timelineData={timelineData}
      lyricsData={lyricsData}
      songTitle={song.title}
      onPrevious={canNavigate ? () => goTo(-1) : undefined}
      onNext={canNavigate ? () => goTo(1) : undefined}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
