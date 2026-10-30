import Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { capoFor, simplifyChord } from './chords-helper';
import { createSyncMaster } from './sync-master';

// --- CONFIGURATION ---
const LOOKAHEAD_OFFSET = 0.25; // 250ms d'avance pour l'anticipation

const DEFAULT_VIDEO = {
  hlsUrl: 'https://customer-xt0jrjpvyjrllivt.cloudflarestream.com/5c612fa3d642cb50d7d09def5b3fe61b/manifest/video.m3u8',
  posterUrl: 'https://customer-xt0jrjpvyjrllivt.cloudflarestream.com/5c612fa3d642cb50d7d09def5b3fe61b/thumbnails/thumbnail.jpg',
};

const KEY_TINTS = 3; // nombre de teintes (kc-0…kc-2 dans styles.css)
const KEY_CHANGE_LEAD = 10; // s d'avance pour allumer la case du changement de tonalité (à droite de capo) ; le fond des accords suit le temps réel
const REWIND_SECONDS = 3; // touche ← : retour en arrière
const VOLUME_STEP = 0.2; // raccourcis volume : ±20 % (borné à 0–100 %, limite de HTMLMediaElement.volume)
const PERFORMANCE_MUTE = ['guitar', 'piano']; // « je joue » : on coupe les instruments que l'on joue soi-même
const KARAOKE_MUTE = ['vocals', ...PERFORMANCE_MUTE]; // karaoké : reste bass, drums, other
// Raccourcis Stream Deck (touches 1 à 0, clavier principal ou pavé numérique) → action sur le mixeur
const MIXER_SHORTCUTS = {
  1: { type: 'set', muted: KARAOKE_MUTE },
  2: { type: 'toggle', names: ['vocals'] },
  3: { type: 'toggle', names: PERFORMANCE_MUTE },
  4: { type: 'volume', name: 'vocals', delta: VOLUME_STEP },
  5: { type: 'volume', name: 'vocals', delta: -VOLUME_STEP },
  6: { type: 'volume', name: 'piano', delta: VOLUME_STEP },
  7: { type: 'volume', name: 'piano', delta: -VOLUME_STEP },
  8: { type: 'volume', name: 'guitar', delta: VOLUME_STEP },
  9: { type: 'volume', name: 'guitar', delta: -VOLUME_STEP },
  0: { type: 'set', muted: [] },
};
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac)(\?|#|$)/i;
const DRIFT_MAX = 0.06; // écart toléré entre pistes (s)
const HLS_EXT = /\.m3u8(\?|#|$)/i;

// --- HELPERS ---
const formatTime = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const formatKey = (keyString) => {
  if (!keyString) return '--';
  return keyString.replace(':', ' ').replace(/^\w/, (c) => c.toUpperCase());
};

const parseChordifyData = (rawChordsString) => {
  if (!rawChordsString) return [];
  return rawChordsString
    .trim()
    .split('\n')
    .map((line, index) => {
      const parts = line.split(';');
      if (parts.length < 4) return null;
      let chordClean = parts[1].replace(':', '');
      if (chordClean === 'N') chordClean = '';
      return {
        id: index,
        beat: parseInt(parts[0], 10),
        chord: chordClean,
        start: parseFloat(parts[2]),
        end: parseFloat(parts[3]),
      };
    })
    .filter((item) => item !== null);
};

const VideoPlayer = ({ videoMeta, timelineData = null, lyricsData = null, onProgressUpdate, songTitle, onPrevious, onNext, songId, onQueue, onSelect }) => {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [manualHide, setManualHide] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);
  const activeCellRef = useRef(null);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Multipiste : la 1re piste est portée par le <video> (maître), les autres par des <audio> synchronisés
  const tracks = videoMeta?.tracks;
  const trackKey = tracks?.map((t) => t.url).join('|');
  const [mutedTracks, setMutedTracks] = useState([]);
  const [gains, setGains] = useState({}); // volume par piste (0–1, défaut 1)
  const slavesRef = useRef([]);

  const { hlsUrl, posterUrl } = tracks?.length
    ? { hlsUrl: tracks[0].url, posterUrl: videoMeta.posterUrl }
    : videoMeta?.hlsUrl
      ? videoMeta
      : DEFAULT_VIDEO;

  // Un fichier audio (mp3...) n'a pas d'image : on affiche toujours la grille plein écran
  const isAudio = AUDIO_EXT.test(hlsUrl);
  const hideVideo = manualHide || isAudio;

  // --- TIMELINE ---
  const parsedTimeline = useMemo(
    () => (timelineData?.timeline ? parseChordifyData(timelineData.timeline) : []),
    [timelineData]
  );

  // --- PAROLES : lignes à plat, triées par début (le JSON a un offset global) ---
  const lyricLines = useMemo(() => {
    const offset = lyricsData?.offset ?? 0;
    return (lyricsData?.sections ?? [])
      .flatMap((sec) => sec.lines ?? [])
      .filter((l) => l.words?.length)
      .map((l) => ({
        start: l.start + offset,
        end: l.end + offset,
        words: l.words.map((w) => ({ t: w.t, start: w.start + offset })),
      }))
      .sort((a, b) => a.start - b.start);
  }, [lyricsData]);

  // Ligne courante = dernière ligne commencée (affichée un peu en avance), conservée pendant les silences
  const lyricIndex = useMemo(() => {
    const t = currentTime + LOOKAHEAD_OFFSET;
    let found = -1;
    for (let i = 0; i < lyricLines.length && lyricLines[i].start <= t; i++) found = i;
    return found;
  }, [lyricLines, currentTime]);

  const metaInfo = useMemo(() => {
    if (!timelineData) return null;
    return {
      bpm: timelineData.bpm,
      key: formatKey(timelineData.key_signature),
      originalKey: timelineData.original_key ? formatKey(timelineData.original_key) : null,
      transposeUp: timelineData.transpose_up,
      transposeDown: timelineData.transpose_down,
      capo: timelineData.original_key
        ? capoFor(timelineData.original_key, timelineData.key_signature)
        : timelineData.transpose_down != null
          ? (12 - (timelineData.transpose_down % 12)) % 12 // sans clé d'origine : TD -1 => capo 1
          : null,
    };
  }, [timelineData]);

  // Changements de tonalité : une case par changement, allumée 2 s avant qu'il survienne
  const keyChanges = useMemo(
    () => (timelineData?.timeline_key ?? []).filter((k) => Number.isFinite(k.time) && k.transpose != null),
    [timelineData]
  );
  // Valeur affichée = écart relatif au TU de base (TU 9, timelineKey 7 → 2) : le nombre d'appuis ↑/↓ pour ajuster le transpose en direct
  const baseTU = metaInfo?.transposeUp ?? (metaInfo?.transposeDown != null ? (metaInfo.transposeDown + 12) % 12 : null);
  const relativeShift = (transpose) => (baseTU == null ? transpose : baseTU - (((transpose % 12) + 12) % 12));
  const keyChangeAt = (t, lead = 0) => keyChanges.reduce((acc, k, i) => (t >= k.time - lead ? i : acc), -1);
  const activeKeyChange = keyChangeAt(currentTime, KEY_CHANGE_LEAD);
  // Teinte du fond des accords selon le tronçon de tonalité (jamais jaune : réservé à l'accord à jouer)
  const keyTint = (start) => {
    const i = keyChangeAt(start);
    return i < 0 ? '' : ` kc-${i % KEY_TINTS}`;
  };

  const uniqueChords = useMemo(
    () => Array.from(new Set(parsedTimeline.map((i) => i.chord).filter(Boolean))),
    [parsedTimeline]
  );

  // --- SOURCE HLS ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls;
    const wasPlaying = !video.paused; // changer de source met le lecteur en pause : on reprend ensuite
    if (!HLS_EXT.test(hlsUrl) || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl; // mp3/mp4 directs, ou Safari : HLS natif
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    }
    setActiveIndex(-1);
    setCurrentTime(0);
    setDuration(0);
    if (wasPlaying || playOnLoadRef.current) video.play().catch(() => {});
    playOnLoadRef.current = false;
    return () => hls?.destroy();
  }, [hlsUrl]);

  // --- PISTES SECONDAIRES : suivent play/pause/seek du maître, avec rattrapage de dérive ---
  useEffect(() => {
    const master = videoRef.current;
    const slaves = (tracks ?? []).slice(1).map((t) => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = t.url;
      a.dataset.track = t.name;
      return a;
    });
    slavesRef.current = slaves;
    if (!master || slaves.length === 0) return;

    const align = () => slaves.forEach((a) => { a.currentTime = master.currentTime; });
    const play = () => { align(); slaves.forEach((a) => a.play().catch(() => {})); };
    const pause = () => slaves.forEach((a) => a.pause());
    const onPlaying = () => { if (slaves[0].paused) play(); };
    const events = { play, pause, seeked: align, waiting: pause, playing: onPlaying, ratechange: () => slaves.forEach((a) => { a.playbackRate = master.playbackRate; }) };
    Object.entries(events).forEach(([e, fn]) => master.addEventListener(e, fn));
    if (!master.paused) play();

    const drift = setInterval(() => {
      if (master.paused || master.seeking) return;
      slaves.forEach((a) => {
        if (Math.abs(a.currentTime - master.currentTime) > DRIFT_MAX) a.currentTime = master.currentTime;
      });
    }, 500);

    return () => {
      clearInterval(drift);
      Object.entries(events).forEach(([e, fn]) => master.removeEventListener(e, fn));
      slaves.forEach((a) => { a.pause(); a.removeAttribute('src'); a.load(); });
      slavesRef.current = [];
    };
  }, [trackKey]);

  // Mute / solo par piste
  useEffect(() => {
    const names = (tracks ?? []).map((t) => t.name);
    const vol = (name) => (mutedTracks.includes(name) ? 0 : gains[name] ?? 1);
    if (videoRef.current && names.length) videoRef.current.volume = vol(names[0]);
    slavesRef.current.forEach((a) => { a.volume = vol(a.dataset.track); });
  }, [trackKey, mutedTracks, gains]);

  const toggleTrack = (name) =>
    setMutedTracks((m) => (m.includes(name) ? m.filter((n) => n !== name) : [...m, name]));

  // Raccourcis du mixeur (Stream Deck) ; les pistes absentes de la chanson sont ignorées
  const mixerActionRef = useRef(null);
  mixerActionRef.current = (action) => {
    const names = (tracks ?? []).map((t) => t.name);
    if (names.length === 0) return;
    if (action.type === 'set') {
      setMutedTracks(action.muted.filter((n) => names.includes(n)));
    } else if (action.type === 'toggle') {
      const targets = action.names.filter((n) => names.includes(n));
      // Tout est coupé → on réactive ; sinon on coupe tout
      setMutedTracks((m) =>
        targets.every((n) => m.includes(n)) ? m.filter((n) => !targets.includes(n)) : [...new Set([...m, ...targets])]
      );
    } else if (action.type === 'volume' && names.includes(action.name)) {
      setGains((g) => {
        const next = Math.round(((g[action.name] ?? 1) + action.delta) * 10) / 10;
        return { ...g, [action.name]: Math.min(1, Math.max(0, next)) };
      });
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  // Commandes de transport distantes (Stream Deck) : play/pause, recommencer, chanson suivante / précédente
  const transportRef = useRef({});
  const remoteRef = useRef({}); // callbacks du parent, lus par le hub sans le reconnecter à chaque rendu
  remoteRef.current = { onQueue };
  const playOnLoadRef = useRef(false); // « lire maintenant » : la chanson choisie démarre dès son chargement
  transportRef.current = {
    'play-pause': togglePlay,
    restart: () => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = 0;
      setCurrentTime(0);
      video.play().catch(() => {});
    },
    next: onNext,
    previous: onPrevious,
    play: (name) => {
      if (name === songId) return transportRef.current.restart();
      playOnLoadRef.current = true;
      onSelect?.(name);
    },
  };

  // --- MOTEUR DE SYNCHRONISATION ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const intervalId = setInterval(() => {
      const time = video.currentTime;
      if (!seeking) setCurrentTime(time);
      if (!video.paused) onProgressUpdate?.(time);
      if (parsedTimeline.length === 0) return;

      // Aussi en pause : après un déplacement du curseur, la grille suit
      const visualTime = time + LOOKAHEAD_OFFSET;
      const foundIndex = parsedTimeline.findIndex(
        (item) => visualTime >= item.start && visualTime < item.end
      );
      if (foundIndex !== -1) setActiveIndex((prev) => (prev === foundIndex ? prev : foundIndex));
    }, 100);
    return () => clearInterval(intervalId);
  }, [parsedTimeline, onProgressUpdate, seeking]);

  // --- SYNCHRO WebSocket : ce lecteur est le maître de la timeline de web_lyrics_karaoke ---
  const syncRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || new URLSearchParams(location.search).get('sync') === 'off') return;
    const sync = createSyncMaster();
    syncRef.current = sync;
    // Commandes distantes (Stream Deck via /control/mixer/<n>) : mêmes actions que les touches 1 à 0
    sync.setMessageHandler((msg) => {
      if (msg.type === 'queue') remoteRef.current.onQueue?.(msg.queue);
      else if (msg.key !== undefined) {
        if (Object.hasOwn(MIXER_SHORTCUTS, msg.key)) mixerActionRef.current?.(MIXER_SHORTCUTS[msg.key]);
      } else {
        transportRef.current[msg.action]?.(msg.name);
      }
    });
    const push = () => sync.sendState(video);
    const events = ['play', 'pause', 'seeked', 'ratechange', 'ended', 'loadedmetadata'];
    events.forEach((e) => video.addEventListener(e, push));
    const beat = setInterval(() => { if (!video.paused) push(); }, 1000);
    return () => {
      clearInterval(beat);
      events.forEach((e) => video.removeEventListener(e, push));
      sync.close();
      syncRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncRef.current?.sendSong(songTitle ?? '', songTitle ?? '', lyricsData ?? null, songId ?? null);
    if (videoRef.current) syncRef.current?.sendState(videoRef.current);
  }, [lyricsData, songTitle, songId]);

  // --- CLAVIER (réel ou virtuel/injecté) : ← = -3 s, Espace = play/pause, 1–0 = mixeur (voir MIXER_SHORTCUTS) ---
  useEffect(() => {
    const isSpace = (e) => e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const isLeft = (e) => e.key === 'ArrowLeft' || e.code === 'ArrowLeft';

    const onKeyDown = (e) => {
      const video = videoRef.current;
      if (!video || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isLeft(e)) {
        e.preventDefault();
        const t = Math.max(0, video.currentTime - REWIND_SECONDS);
        video.currentTime = t;
        setCurrentTime(t);
      } else if (/^(Digit|Numpad)\d$/.test(e.code) && MIXER_SHORTCUTS[e.code.slice(-1)]) {
        e.preventDefault();
        if (!e.repeat) mixerActionRef.current?.(MIXER_SHORTCUTS[e.code.slice(-1)]);
      } else if (isSpace(e)) {
        e.preventDefault(); // évite aussi le défilement de la page / le clic sur un bouton focalisé
        if (e.repeat) return;
        if (video.paused) video.play();
        else video.pause();
      }
    };
    // Sur un bouton focalisé, Espace déclenche le clic au relâchement : on l'annule
    const onKeyUp = (e) => {
      if (isSpace(e)) e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  // Clic sur une case d'accord : saute à sa position dans la timeline
  const seekToItem = (item, index) => {
    if (!videoRef.current || !Number.isFinite(item.start)) return;
    videoRef.current.currentTime = item.start;
    setCurrentTime(item.start);
    setActiveIndex(index);
  };

  const handleSeek = (e) => {
    const t = Number(e.target.value);
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  // --- VUE MATRICE (15 ACCORDS = 3 LIGNES DE 5) ---
  const visibleGrid = useMemo(() => {
    if (activeIndex === -1) return [[], [], []];
    const slice = parsedTimeline.slice(activeIndex, activeIndex + 15);
    while (slice.length < 15) slice.push({ id: `filler-${slice.length}`, chord: '', beat: 0 });
    return [slice.slice(0, 5), slice.slice(5, 10), slice.slice(10, 15)];
  }, [activeIndex, parsedTimeline]);

  // --- VUE GRILLE COMPLÈTE (vidéo masquée) : mesures regroupées en lignes ---
  const fullRows = useMemo(() => {
    const measures = [];
    parsedTimeline.forEach((item, i) => {
      if (measures.length === 0 || item.beat === 1) measures.push([]);
      const prev = parsedTimeline[i - 1];
      measures[measures.length - 1].push({ ...item, index: i, showChord: !prev || prev.chord !== item.chord });
    });
    const perRow = wide ? 4 : 2;
    const rows = [];
    for (let i = 0; i < measures.length; i += perRow) rows.push(measures.slice(i, i + perRow));
    return rows;
  }, [parsedTimeline, wide]);

  // Garde l'accord actif visible
  useEffect(() => {
    if (hideVideo) activeCellRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, hideVideo]);

  const renderRow = (rowItems, rowIndex) => {
    const rowOpacity = rowIndex === 0 ? 1 : rowIndex === 1 ? 0.7 : 0.5;
    return (
      <div key={rowIndex} className="grid-row">
        {rowItems.map((item, colIndex) => {
          const isCurrent = rowIndex === 0 && colIndex === 0;
          const isStartOfMeasure = item.beat === 1;
          if (!item.chord && !isCurrent) return <div key={colIndex} className="chord-box" />;
          return (
            <div key={`${rowIndex}-${colIndex}`} className="cell-wrapper">
              {isStartOfMeasure && <div className="measure-separator" style={{ opacity: rowOpacity }} />}
              <div
                className={`chord-box ${isCurrent ? 'active' : 'future'}${keyTint(item.start)}`}
                style={{ opacity: isCurrent ? 1 : rowOpacity }}
                onClick={() => seekToItem(item, item.id)}
              >
                <span className="chord-text">{simplifyChord(item.chord)}</span>
                {isCurrent && <span className="playing-indicator">JOUER</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderLyrics = () => {
    if (lyricLines.length === 0) return null;
    const line = lyricLines[lyricIndex];
    const next = lyricLines[lyricIndex + 1];
    return (
      <div className="lyrics-bar">
        <div className="lyrics-line">
          {line?.words.map((w, i) => (
            <span key={i} className={currentTime >= w.start ? 'sung' : ''}>{w.t} </span>
          ))}
        </div>
        <div className="lyrics-line next">{next?.words.map((w) => w.t).join(' ')}</div>
      </div>
    );
  };

  return (
    <div className="main-container">
      {/* 1. VIDÉO */}
      <div className={`video-container ${hideVideo ? 'hidden' : ''}`}>
        <video
          ref={videoRef}
          className="video"
          poster={posterUrl}
          loop
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        />
        {metaInfo && (
          <div className="meta-overlay">
            <div className="meta-badge">
              <span className="meta-label">Tonalité</span>
              <span className="meta-value">{simplifyChord(metaInfo.key)}</span>
            </div>
            <div className="meta-separator" />
            <div className="meta-badge">
              <span className="meta-label">Tempo</span>
              <span className="meta-value">{metaInfo.bpm}</span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
      {/* 2. ENTÊTE FIGÉ : titre, play, sélection des stems */}
      <div className="panel-header">
      {songTitle &&<div className="song-title">{songTitle}</div>}
      <div className="top-row">
      {metaInfo ? <div className="info-side left">
          <span>
            {metaInfo.transposeUp != null && `TU : ${metaInfo.transposeUp}`}
            {metaInfo.transposeUp != null && metaInfo.transposeDown != null && '  '}
            {metaInfo.transposeDown != null && `TD : ${metaInfo.transposeDown}`}
            {metaInfo.capo != null && '  '}
            {metaInfo.capo != null && `Capo : ${metaInfo.capo}`}
          </span>
          {keyChanges.map((k, i) => (
            <span key={i} className={`key-change${i === activeKeyChange ? ' active' : ''}`}>{relativeShift(k.transpose)}</span>
          ))}
      </div> : <div className="info-side" />}
      <div className="controls">
        {onPrevious && (
          <button className="nav-button" onClick={onPrevious} title="Chanson précédente" aria-label="Chanson précédente">
            ⏮
          </button>
        )}
        <button className="play-button" onClick={togglePlay}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        {onNext && (
          <button className="nav-button" onClick={onNext} title="Chanson suivante" aria-label="Chanson suivante">
            ⏭
          </button>
        )}
        {!isAudio && (
          <button className="toggle-video-button" onClick={() => setManualHide((h) => !h)}>
            {hideVideo ? '🎬 Afficher la vidéo' : '🙈 Masquer la vidéo'}
          </button>
        )}
      </div>
      {metaInfo ? <div className="info-side right">
          <span>
            Key : {metaInfo.originalKey ? `${simplifyChord(metaInfo.originalKey)} => ` : ''}
            {simplifyChord(metaInfo.key)}
          </span>
      </div> : <div className="info-side" />}
      </div>

      {tracks?.length > 1 && (
        <div className="mixer">
          {tracks.map((t) => (
            <button
              key={t.name}
              className={`mixer-button ${mutedTracks.includes(t.name) ? 'muted' : ''}`}
              onClick={() => toggleTrack(t.name)}
              title={mutedTracks.includes(t.name) ? 'Activer la piste' : 'Couper la piste'}
            >
              {t.name}
              {(gains[t.name] ?? 1) < 1 && <small className="mixer-gain"> {Math.round((gains[t.name] ?? 1) * 100)}%</small>}
            </button>
          ))}
        </div>
      )}
      </div>

      {/* 3. PAROLES (taille fixe, au-dessus des accords) */}
      {renderLyrics()}

      {/* 4. ACCORDS */}
      {hideVideo ? (
        <div className="full-grid">
          {fullRows.length === 0 && <p className="empty-state">Prêt à jouer...</p>}
          {fullRows.map((row, r) => (
            <div key={r} className="full-row">
              {row.map((measure, m) => (
                <div key={m} className="full-measure">
                  {measure.map((cell) => {
                    const isActive = cell.index === activeIndex;
                    return (
                      <div
                        key={cell.id}
                        ref={isActive ? activeCellRef : null}
                        className={`full-cell ${isActive ? 'active' : ''}${keyTint(cell.start)}`}
                        onClick={() => seekToItem(cell, cell.index)}
                      >
                        {cell.showChord ? simplifyChord(cell.chord) : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
      <div className="karaoke-container">
        {visibleGrid[0].length > 0 ? (
          <div className="grid-container">
            {renderRow(visibleGrid[0], 0)}
            {renderRow(visibleGrid[1], 1)}
            {renderRow(visibleGrid[2], 2)}
          </div>
        ) : (
          <p className="empty-state">Prêt à jouer...</p>
        )}
      </div>
      )}

      {/* CURSEUR DE LECTURE : toujours visible (collé en bas du panneau) */}
      <div className="seek-bar">
        <span className="seek-time">{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onMouseDown={() => setSeeking(true)}
          onTouchStart={() => setSeeking(true)}
          onMouseUp={() => setSeeking(false)}
          onTouchEnd={() => setSeeking(false)}
          onChange={handleSeek}
          aria-label="Position de lecture"
        />
        <span className="seek-time">{formatTime(duration)}</span>
      </div>

      {/* 4. RÉSUMÉ */}
      {!hideVideo && uniqueChords.length > 0 && (
        <div className="summary">
          <h3 className="summary-title">Accords du morceau :</h3>
          <div className="summary-grid">
            {uniqueChords.map((c) => (
              <span key={c} className="summary-badge">{simplifyChord(c)}</span>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default VideoPlayer;
