import './styles.css';
import { analyzeSong, difficultyClass, keyLabel, MAX_CAPO, normalizeTimeline, renderForCapo } from './guitar-transpose.js';
import { createFollower, resolveHost } from './sync-follower.js';

const LOOKAHEAD = 0.25; // même anticipation que le lecteur d'accords
const GRID_CELLS = 15; // 3 lignes de 5
const ROW_OPACITY = [1, 0.7, 0.5];

const host = resolveHost();
const app = document.getElementById('app');
app.innerHTML = `
  <div class="page">
    <header class="head">
      <div class="title" id="title">En attente du lecteur d'accords…</div>
      <div class="status" id="status"></div>
      <div class="bar">
        <div class="badge"><span class="lbl">Son</span><span class="val" id="sound">--</span></div>
        <div class="capo">
          <button id="capoMinus" aria-label="Capo moins">−</button>
          <div class="badge"><span class="lbl">Capo</span><span class="val" id="capoVal">0</span></div>
          <button id="capoPlus" aria-label="Capo plus">+</button>
        </div>
        <div class="badge"><span class="lbl">Formes en</span><span class="val" id="shape">--</span></div>
        <button id="auto" class="auto" hidden>↺ Auto <span id="autoVal"></span></button>
      </div>
    </header>
    <section id="lyrics" class="lyrics" hidden></section>
    <main id="grid" class="grid"><p class="empty">Prêt à jouer…</p></main>
    <details class="compare"><summary>Comparer les capos</summary><div id="compare"></div></details>
    <section class="summary"><h3>Accords du morceau</h3><div id="summary" class="chips"></div></section>
  </div>`;
const $ = (id) => document.getElementById(id);

const state = {
  songId: null,
  song: null, // résultat de analyzeSong
  capo: 0,
  manual: false, // le capo a été changé à la main
  played: null, // renderForCapo du capo courant
  lyrics: [],
  token: 0,
  lastKey: '',
};

const flattenLyrics = (l) => {
  const offset = l?.offset ?? 0;
  return (l?.sections ?? [])
    .flatMap((s) => s.lines ?? [])
    .filter((x) => x.words?.length)
    .map((x) => ({ start: x.start + offset, words: x.words.map((w) => ({ t: w.t, start: w.start + offset })) }))
    .sort((a, b) => a.start - b.start);
};

// --- DONNÉES : l'index et la timeline viennent du serveur d'accords ; tout le calcul se fait ici ---
const origin = `http://${host}`;
const loadSong = async (msg) => {
  $('title').textContent = msg.title || msg.name || '';
  state.lyrics = flattenLyrics(msg.lyrics);
  if (msg.id === state.songId && state.song) return; // simple mise à jour des paroles
  const token = ++state.token;
  state.songId = msg.id;
  state.song = null;
  render();
  try {
    const list = await (await fetch(`${origin}/stems/index.json`)).json();
    const entry = list.find((s) => s.name === msg.id) ?? list.find((s) => s.title === msg.title);
    if (!entry) throw new Error('chanson introuvable');
    const data = normalizeTimeline(await (await fetch(`${origin}${entry.json}`)).json());
    if (token !== state.token) return; // une autre chanson est arrivée entre-temps
    state.song = analyzeSong(data);
    state.manual = false;
    state.capo = state.song.recommended;
    render();
  } catch (e) {
    console.error('Timeline introuvable', e);
    if (token === state.token) $('status').textContent = `Accords introuvables pour cette chanson (${e.message})`;
  }
};

// --- CAPO : + / − simulent les accords en direct ; « Auto » revient à la recommandation ---
const setCapo = (capo) => {
  if (!state.song) return;
  state.capo = Math.min(MAX_CAPO, Math.max(0, capo));
  state.manual = state.capo !== state.song.recommended;
  render();
};
$('capoMinus').onclick = () => setCapo(state.capo - 1);
$('capoPlus').onclick = () => setCapo(state.capo + 1);
$('auto').onclick = () => state.song && setCapo(state.song.recommended);

// --- RENDU STATIQUE (changement de chanson / de capo) ---
const chip = (label, cost) => `<span class="chip ${difficultyClass(cost)}">${label}</span>`;

function render() {
  const s = state.song;
  document.querySelectorAll('.capo button, .auto').forEach((b) => (b.disabled = !s));
  state.lastKey = '';
  if (!s) {
    $('sound').textContent = $('shape').textContent = '--';
    $('capoVal').textContent = '0';
    $('grid').innerHTML = '<p class="empty">Prêt à jouer…</p>';
    $('summary').innerHTML = $('compare').innerHTML = '';
    $('auto').hidden = true;
    state.played = null;
    return;
  }
  state.played = renderForCapo(s, state.capo);
  const { play, shapeKey } = state.played;
  $('capoVal').textContent = state.capo;
  $('sound').textContent = keyLabel(s.soundKey);
  $('shape').textContent = keyLabel(shapeKey);
  $('auto').hidden = !state.manual;
  $('autoVal').textContent = `(capo ${s.recommended})`;
  $('status').textContent = '';

  const seen = new Set();
  $('summary').innerHTML = s.items
    .filter((i) => i.chord && !seen.has(i.chord) && seen.add(i.chord))
    .map((i) => chip(play(i.chord).label, play(i.chord).cost))
    .join('');

  const best = Math.min(...s.candidates.map((c) => c.score));
  $('compare').innerHTML = s.candidates
    .map((c) => {
      const cls = [c.capo === state.capo ? 'current' : '', c.capo === s.recommended ? 'reco' : ''].join(' ');
      const hard = c.hard.length ? [...new Set(c.hard)].slice(0, 4).join(' ') : 'aucun accord difficile';
      return `<button class="cmp ${cls}" data-capo="${c.capo}"><b>Capo ${c.capo}${c.capo === s.recommended ? ' ★' : ''}</b><i style="width:${Math.max(6, 100 - (c.score - best) * 40)}%"></i><small>${hard}</small></button>`;
    })
    .join('');
  $('compare').querySelectorAll('.cmp').forEach((b) => (b.onclick = () => setCapo(Number(b.dataset.capo))));
  paint(follower.now());
}

// --- RENDU TEMPS RÉEL : ne touche le DOM que si quelque chose change ---
// Dernier accord commencé (reste dessus pendant un trou)
const findActive = (items, t) => {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
};

function paint(time) {
  const s = state.song;
  if (s && state.played) {
    const idx = findActive(s.items, time + LOOKAHEAD);
    const key = `${idx}|${state.capo}`;
    if (key !== state.lastKey) {
      state.lastKey = key;
      paintGrid(s, idx);
    }
  }
  paintLyrics(time);
}

function paintGrid(s, idx) {
  if (idx < 0) {
    $('grid').innerHTML = '<p class="empty">Prêt à jouer…</p>';
    return;
  }
  const { play } = state.played;
  const cells = s.items.slice(idx, idx + GRID_CELLS);
  let html = '';
  for (let r = 0; r < 3; r++) {
    html += '<div class="row">';
    for (let c = 0; c < 5; c++) {
      const item = cells[r * 5 + c];
      const current = r === 0 && c === 0;
      if (!item || (!item.chord && !current)) {
        html += '<div class="box"></div>';
        continue;
      }
      const { label, cost } = play(item.chord);
      const cls = current ? 'active' : `future ${difficultyClass(cost)}`;
      html += `<div class="cell">${item.beat === 1 ? '<div class="sep"></div>' : ''}<div class="box ${cls}" style="opacity:${current ? 1 : ROW_OPACITY[r]}">${label}</div></div>`;
    }
    html += '</div>';
  }
  $('grid').innerHTML = html;
}

const esc = (x) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
let lyricKey = '';
function paintLyrics(time) {
  const el = $('lyrics');
  el.hidden = state.lyrics.length === 0;
  if (el.hidden) return;
  const t = time + LOOKAHEAD;
  let i = -1;
  while (i + 1 < state.lyrics.length && state.lyrics[i + 1].start <= t) i++;
  const line = state.lyrics[i];
  const next = state.lyrics[i + 1];
  const sung = line ? line.words.filter((w) => time >= w.start).length : 0;
  const key = `${state.token}|${i}|${sung}`;
  if (key === lyricKey) return;
  lyricKey = key;
  el.innerHTML = `<div class="l cur">${(line?.words ?? []).map((w, k) => `<span class="${k < sung ? 'sung' : ''}">${esc(w.t)} </span>`).join('')}</div><div class="l nxt">${esc((next?.words ?? []).map((w) => w.t).join(' '))}</div>`;
}

// --- SYNCHRO (lecture seule) ---
const follower = createFollower(host, {
  onSong: loadSong,
  onStatus: (ok) => {
    if (!ok) $('status').textContent = "Lecteur d'accords injoignable…";
    else if (!state.song) $('status').textContent = '';
  },
});
const loop = () => {
  paint(follower.now());
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
render();
