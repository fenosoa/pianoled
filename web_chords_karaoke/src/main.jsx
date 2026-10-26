import React from 'react';
import { createRoot } from 'react-dom/client';
import VideoPlayer from './g-video-player.component.jsx';
import './styles.css';

// --- MORCEAUX LOCAUX : web/media/<nom>.json + <nom>.mp3 (ou .mp4, ...) ---
const files = import.meta.glob('../media/*.{json,mp3,mp4,m4a,aac,wav,ogg,flac}', {
  query: '?url',
  import: 'default',
  eager: true,
});

const songs = {};
for (const [path, url] of Object.entries(files)) {
  const [, name, ext] = path.match(/\/([^/]+)\.(\w+)$/);
  // <nom>.lyrics.json = paroles (exportées par web_lyrics_karaoke), <nom>.json = accords
  const lyrics = name.endsWith('.lyrics');
  const key = lyrics ? name.slice(0, -'.lyrics'.length) : name;
  songs[key] ??= {};
  songs[key][lyrics ? 'lyrics' : ext === 'json' ? 'json' : 'media'] = url;
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

// Usage : ?song=wgmy (défaut : premier morceau de web/media)
// Surcharges possibles : ?timeline=...&media=... (ou video= / audio=) &poster=...
const params = new URLSearchParams(window.location.search);

// Playlist : seulement les couples complets json + média, par ordre alphabétique
const playlist = Object.entries(songs)
  .filter(([, s]) => s.json && s.media)
  .map(([name, s]) => ({ name, ...s }));
const hasOverride = ['timeline', 'media', 'video', 'audio'].some((k) => params.has(k));

function App() {
  const [timelineData, setTimelineData] = React.useState(null);
  const [lyricsData, setLyricsData] = React.useState(null);
  const [songIndex, setSongIndex] = React.useState(() =>
    Math.max(0, playlist.findIndex((s) => s.name === params.get('song')))
  );
  const song = playlist[songIndex] ?? {};
  const timelineUrl = params.get('timeline') || song.json || '/timeline.json';

  React.useEffect(() => {
    let cancelled = false;
    setTimelineData(null); // évite d'afficher les accords de la chanson précédente
    fetch(timelineUrl)
      .then((r) => r.json())
      .then((d) => !cancelled && setTimelineData(normalizeTimeline(d)))
      .catch((e) => console.error('Timeline introuvable', e));
    return () => {
      cancelled = true;
    };
  }, [timelineUrl]);

  // Paroles facultatives : ?lyrics=... ou media/<nom>.lyrics.json
  const lyricsUrl = params.get('lyrics') || song.lyrics;
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

  const mediaUrl = params.get('media') || params.get('video') || params.get('audio') || song.media;
  const videoMeta = mediaUrl ? { hlsUrl: mediaUrl, posterUrl: params.get('poster') } : undefined;
  const canNavigate = playlist.length > 1 && !hasOverride;

  return (
    <VideoPlayer
      videoMeta={videoMeta}
      timelineData={timelineData}
      lyricsData={lyricsData}
      songTitle={song.name}
      onPrevious={canNavigate ? () => goTo(-1) : undefined}
      onNext={canNavigate ? () => goTo(1) : undefined}
    />
  );
}

createRoot(document.getElementById('root')).render(<App />);
