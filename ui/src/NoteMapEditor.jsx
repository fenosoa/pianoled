import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './Icon.jsx';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`; // 60 = C4, 21 = A0
const APPLY_DELAY_MS = 1500;

/**
 * Notes are fixed; only the LED index is editable. A change is saved when the field loses focus
 * (or Enter), or immediately for the ◀ ▶ buttons. The service is restarted once edits stop
 * (debounced) so the new table is live without a manual "apply".
 */
export function NoteMapEditor({ notify, mappingMode, running, onUseTable }) {
  const [map, setMap] = useState(null); // { "60": 72 } — what is saved
  const [ledCount, setLedCount] = useState(120);
  const [edit, setEdit] = useState({}); // note -> text being typed (only while focused)
  const [flash, setFlash] = useState({}); // note -> 'saved'
  const [sync, setSync] = useState('idle'); // idle | saving | pending | applying
  const [filter, setFilter] = useState('');
  const [hover, setHover] = useState(null);
  const [shift, setShift] = useState('1');

  const mapRef = useRef(null);
  const chain = useRef(Promise.resolve());
  const applyTimer = useRef(null);

  const load = useCallback(async () => {
    const r = await api('/api/note-map');
    setLedCount(r.ledCount);
    mapRef.current = r.map;
    setMap(r.map);
  }, []);
  useEffect(() => { load().catch((e) => notify(e.message, 'err')); }, [load, notify]);
  useEffect(() => () => clearTimeout(applyTimer.current), []);

  // Serialised writes of the latest full table; restart scheduled after the last one.
  const persist = useCallback(
    (next, touched) => {
      mapRef.current = next;
      setMap(next);
      setSync('saving');
      chain.current = chain.current.then(async () => {
        try {
          await api('/api/note-map', { map: mapRef.current, apply: false }, 'PUT');
          setFlash((f) => ({ ...f, ...Object.fromEntries(touched.map((n) => [n, true])) }));
          setTimeout(() => setFlash((f) => { const c = { ...f }; touched.forEach((n) => delete c[n]); return c; }), 1200);
          setSync('pending');
          clearTimeout(applyTimer.current);
          applyTimer.current = setTimeout(async () => {
            setSync('applying');
            try {
              const r = await api('/api/note-map', { map: mapRef.current, apply: true }, 'PUT');
              if (r.restarted) notify('Table enregistrée, service relancé');
            } catch (e) {
              notify(e.message, 'err');
            }
            setSync('idle');
          }, APPLY_DELAY_MS);
        } catch (e) {
          notify(`Enregistrement refusé : ${e.message}`, 'err');
          await load().catch(() => {});
          setSync('idle');
        }
      });
    },
    [load, notify]
  );

  const validLed = (n) => Number.isInteger(n) && n >= 0 && n < ledCount;

  const commit = (note, text) => {
    setEdit((e) => { const c = { ...e }; delete c[note]; return c; });
    if (text === undefined || text.trim() === '') return;
    const led = Number(text);
    if (!validLed(led)) return notify(`Note ${note} : LED invalide « ${text} » (0..${ledCount - 1})`, 'err');
    if (led === mapRef.current[note]) return;
    persist({ ...mapRef.current, [note]: led }, [note]);
  };

  const step = (note, d) => {
    const led = mapRef.current[note] + d;
    if (!validLed(led)) return;
    setEdit((e) => { const c = { ...e }; delete c[note]; return c; });
    persist({ ...mapRef.current, [note]: led }, [note]);
  };

  const bulk = (fn) => {
    const next = {};
    for (const [n, l] of Object.entries(mapRef.current)) next[n] = fn(l);
    if (!Object.values(next).every(validLed)) return notify(`Opération refusée : une LED sortirait de 0..${ledCount - 1}`, 'err');
    persist(next, Object.keys(next));
  };
  const shiftAll = (sign) => {
    const d = Number(shift) * sign;
    if (Number.isInteger(d) && d !== 0) bulk((l) => l + d);
  };

  const usage = useMemo(() => {
    const m = new Map();
    for (const [n, l] of Object.entries(map || {})) m.set(l, [...(m.get(l) || []), Number(n)]);
    return m;
  }, [map]);

  if (!map) return <div className="empty">Chargement…</div>;

  const dupCount = [...usage.values()].filter((n) => n.length > 1).length;
  const f = filter.trim().toLowerCase();
  const notes = Object.keys(map).map(Number).sort((a, b) => a - b)
    .filter((n) => !f || String(n).includes(f) || String(map[n]) === f || noteName(n).toLowerCase().includes(f));
  const hoverLed = hover !== null ? map[hover] : null;

  const syncLabel = {
    idle: <span className="sync ok">Enregistré automatiquement</span>,
    saving: <span className="sync">Enregistrement…</span>,
    pending: <span className="sync">Enregistré · relance du service{running ? '' : ' (arrêté)'} dans un instant…</span>,
    applying: <span className="sync">Relance du service…</span>,
  }[sync];

  return (
    <div className="nm">
      <div className="head">
        <h2>Table des notes</h2>
        <p>Modifiez l’index de LED de chaque note (0..{ledCount - 1}) : enregistré dès que le champ perd le focus, ou aussitôt avec ◀ ▶. Fichier <code>config/note-map.json</code>.</p>
      </div>

      {mappingMode !== 'table' && (
        <div className="notice">
          <Icon name="alert" /> Le mode de mapping est <b>{mappingMode}</b> : cette table n’est pas utilisée.
          <button className="btn sm" onClick={onUseTable}>Passer en mode table</button>
          <small>(puis « Appliquer » dans la barre du bas)</small>
        </div>
      )}

      <div className="strip" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: ledCount }, (_, led) => {
          const used = usage.get(led);
          const cls = !used ? '' : used.length > 1 ? 'dup' : 'on';
          return <i key={led} className={`${cls} ${hoverLed === led ? 'hl' : ''}`} title={used ? `LED ${led} ← ${used.map((n) => `${noteName(n)} (${n})`).join(', ')}` : `LED ${led} (libre)`} />;
        })}
      </div>
      <div className="strip-legend">
        <span><i className="on" /> assignée</span><span><i className="dup" /> partagée ({dupCount})</span><span><i /> libre</span>
        <span className="grow" />{syncLabel}
      </div>

      <div className="tools">
        <label className="search"><Icon name="search" /><input placeholder="Filtrer (note, nom, LED)…" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <div className="shift">
          <span>Décaler toutes les LEDs</span>
          <button className="btn sm" onClick={() => shiftAll(-1)} title="Toutes les LEDs − N">−</button>
          <input className="in num" type="number" value={shift} onChange={(e) => setShift(e.target.value)} />
          <button className="btn sm" onClick={() => shiftAll(1)} title="Toutes les LEDs + N">+</button>
        </div>
        <button className="btn ghost" onClick={() => bulk((l) => ledCount - 1 - l)} title={`led → ${ledCount - 1} − led`}>Inverser le sens</button>
      </div>

      <div className="tablewrap">
        <table className="nmtable">
          <thead><tr><th>Note MIDI</th><th>Nom</th><th>LED</th><th /></tr></thead>
          <tbody>
            {notes.map((n) => {
              const shared = (usage.get(map[n]) || []).length > 1;
              return (
                <tr key={n} onMouseEnter={() => setHover(n)} className={shared ? 'dup' : ''}>
                  <td className="nm-note">{n}</td>
                  <td className="nm-name">{noteName(n)}</td>
                  <td>
                    <div className="stepper">
                      <button className="btn sm" onClick={() => step(n, -1)} disabled={map[n] <= 0} title="LED − 1" aria-label={`LED moins 1 pour la note ${n}`}>◀</button>
                      <input
                        className="in num"
                        type="number"
                        min="0"
                        max={ledCount - 1}
                        value={edit[n] !== undefined ? edit[n] : map[n]}
                        onFocus={(e) => { setEdit((s) => ({ ...s, [n]: String(map[n]) })); e.target.select(); }}
                        onChange={(e) => setEdit((s) => ({ ...s, [n]: e.target.value }))}
                        onBlur={(e) => commit(n, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          else if (e.key === 'Escape') { setEdit((s) => { const c = { ...s }; delete c[n]; return c; }); e.currentTarget.blur(); }
                        }}
                      />
                      <button className="btn sm" onClick={() => step(n, 1)} disabled={map[n] >= ledCount - 1} title="LED + 1" aria-label={`LED plus 1 pour la note ${n}`}>▶</button>
                      <span className={`ok-flash ${flash[n] ? 'on' : ''}`}>✓</span>
                    </div>
                  </td>
                  <td />
                </tr>
              );
            })}
            {!notes.length && <tr><td colSpan="4" className="empty">Aucune note.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
