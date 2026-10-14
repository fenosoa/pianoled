import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './Icon.jsx';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`; // 60 = C4, 21 = A0

const toRows = (map) => Object.entries(map).map(([n, l]) => ({ note: String(n), led: String(l) })).sort((a, b) => a.note - b.note);
const rowsKey = (rows) => JSON.stringify(rows.map((r) => [r.note, r.led]));

/** rows -> { map } or { error } (same rules as the server and the service loader). */
function build(rows, ledCount) {
  const map = {};
  const seen = new Set();
  for (const r of rows) {
    const n = Number(r.note);
    const l = Number(r.led);
    if (r.note === '' || !Number.isInteger(n) || n < 0 || n > 127) return { error: `Note invalide « ${r.note} » (0..127)` };
    if (r.led === '' || !Number.isInteger(l) || l < 0 || l >= ledCount) return { error: `Note ${n} : LED invalide « ${r.led} » (0..${ledCount - 1})` };
    if (seen.has(n)) return { error: `Note ${n} définie deux fois` };
    seen.add(n);
    map[n] = l;
  }
  return { map };
}

export function NoteMapEditor({ notify, mappingMode, running, onUseTable }) {
  const [saved, setSaved] = useState(null);
  const [rows, setRows] = useState([]);
  const [ledCount, setLedCount] = useState(120);
  const [filter, setFilter] = useState('');
  const [hover, setHover] = useState(null);
  const [shift, setShift] = useState('1');
  const [raw, setRaw] = useState(null); // string when the JSON view is open
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api('/api/note-map');
    const next = toRows(r.map);
    setLedCount(r.ledCount);
    setRows(next);
    setSaved(rowsKey(next));
  }, []);
  useEffect(() => { load().catch((e) => notify(e.message, 'err')); }, [load, notify]);

  const built = useMemo(() => build(rows, ledCount), [rows, ledCount]);
  const dirty = saved !== null && rowsKey(rows) !== saved;

  const usage = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const l = Number(r.led);
      if (r.led === '' || !Number.isInteger(l)) continue;
      m.set(l, [...(m.get(l) || []), Number(r.note)]);
    }
    return m;
  }, [rows]);
  const dupCount = [...usage.values()].filter((n) => n.length > 1).length;

  const upd = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const del = (idx) => setRows((rs) => rs.filter((_, i) => i !== idx));
  const add = () => {
    const used = new Set(rows.map((r) => Number(r.note)));
    let n = rows.length ? Math.max(...rows.map((r) => Number(r.note) || 0)) + 1 : 60;
    while (used.has(n) && n < 127) n++;
    setRows((rs) => [...rs, { note: String(Math.min(n, 127)), led: '0' }]);
  };
  const shiftAll = (sign) => {
    const d = Number(shift) * sign;
    if (!Number.isInteger(d)) return;
    setRows((rs) => rs.map((r) => (r.led === '' ? r : { ...r, led: String(Number(r.led) + d) })));
  };
  const mirror = () => setRows((rs) => rs.map((r) => (r.led === '' ? r : { ...r, led: String(ledCount - 1 - Number(r.led)) })));
  const sortRows = () => setRows((rs) => [...rs].sort((a, b) => Number(a.note) - Number(b.note)));

  const save = async (apply) => {
    if (built.error) return;
    setBusy(true);
    try {
      const r = await api('/api/note-map', { map: built.map, apply }, 'PUT');
      const next = toRows(built.map);
      setRows(next);
      setSaved(rowsKey(next));
      notify(r.restarted ? 'Table enregistrée, service relancé' : 'Table enregistrée (config/note-map.json)');
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const openRaw = () => setRaw(JSON.stringify(built.map || {}, null, 2));
  const applyRaw = () => {
    try {
      const obj = JSON.parse(raw);
      const map = obj && typeof obj.map === 'object' ? obj.map : obj;
      setRows(toRows(map));
      setRaw(null);
    } catch (e) {
      notify(`JSON invalide : ${e.message}`, 'err');
    }
  };

  const f = filter.trim().toLowerCase();
  const visibleRows = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => !f || r.note.includes(f) || r.led === f || noteName(Number(r.note)).toLowerCase().includes(f));
  const hoverLed = hover !== null && rows[hover] ? Number(rows[hover].led) : null;

  if (saved === null) return <div className="empty">Chargement…</div>;

  return (
    <div className="nm">
      <div className="head">
        <h2>Table des notes</h2>
        <p>Associe chaque note MIDI à un index de LED (0..{ledCount - 1}) — fichier <code>config/note-map.json</code>.</p>
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
          const notes = usage.get(led);
          const cls = !notes ? '' : notes.length > 1 ? 'dup' : 'on';
          return (
            <i key={led} className={`${cls} ${hoverLed === led ? 'hl' : ''}`} title={notes ? `LED ${led} ← ${notes.map((n) => `${noteName(n)} (${n})`).join(', ')}` : `LED ${led} (libre)`} />
          );
        })}
      </div>
      <div className="strip-legend">
        <span><i className="on" /> assignée</span><span><i className="dup" /> partagée ({dupCount})</span><span><i /> libre</span>
        <span className="grow" /><span>{rows.length} notes · {usage.size} LEDs utilisées</span>
      </div>

      <div className="tools">
        <label className="search"><Icon name="search" /><input placeholder="Filtrer (note, nom, LED)…" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
        <button className="btn" onClick={add}><Icon name="plus" /> Ajouter une note</button>
        <div className="shift">
          <span>Décaler les LEDs</span>
          <button className="btn sm" onClick={() => shiftAll(-1)}>−</button>
          <input className="in num" type="number" value={shift} onChange={(e) => setShift(e.target.value)} />
          <button className="btn sm" onClick={() => shiftAll(1)}>+</button>
        </div>
        <button className="btn ghost" onClick={mirror} title={`led → ${ledCount - 1} − led`}>Inverser le sens</button>
        <button className="btn ghost" onClick={sortRows}>Trier</button>
        <button className="btn ghost" onClick={raw === null ? openRaw : () => setRaw(null)}>{raw === null ? 'JSON brut' : 'Fermer le JSON'}</button>
      </div>

      {raw !== null ? (
        <div className="rawbox">
          <textarea spellCheck={false} value={raw} onChange={(e) => setRaw(e.target.value)} />
          <button className="btn primary" onClick={applyRaw}>Charger ce JSON dans l’éditeur</button>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="nmtable">
            <thead><tr><th>Note MIDI</th><th>Nom</th><th>LED</th><th /></tr></thead>
            <tbody>
              {visibleRows.map(({ r, idx }) => {
                const led = Number(r.led);
                const bad = r.led === '' || !Number.isInteger(led) || led < 0 || led >= ledCount;
                const shared = !bad && (usage.get(led) || []).length > 1;
                return (
                  <tr key={idx} onMouseEnter={() => setHover(idx)} className={shared ? 'dup' : ''}>
                    <td><input className="in num" type="number" min="0" max="127" value={r.note} onChange={(e) => upd(idx, { note: e.target.value })} /></td>
                    <td className="nm-name">{r.note !== '' && Number(r.note) >= 0 && Number(r.note) <= 127 ? noteName(Number(r.note)) : '—'}</td>
                    <td><input className={`in num ${bad ? 'invalid' : ''}`} type="number" min="0" max={ledCount - 1} value={r.led} onChange={(e) => upd(idx, { led: e.target.value })} /></td>
                    <td><button className="reset" onClick={() => del(idx)} title="Supprimer"><Icon name="trash" size={14} /></button></td>
                  </tr>
                );
              })}
              {!visibleRows.length && <tr><td colSpan="4" className="empty">Aucune note.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className={`nm-bar ${dirty ? 'dirty' : ''}`}>
        <span className="nm-msg">
          {built.error ? <span className="bad"><Icon name="alert" /> {built.error}</span>
            : dirty ? 'Modifications non enregistrées'
            : 'À jour'}
          {!built.error && dupCount > 0 && <span className="warn"> · {dupCount} LED(s) partagée(s)</span>}
        </span>
        <button className="btn ghost" disabled={!dirty || busy} onClick={load}>Annuler</button>
        <button className="btn" disabled={!dirty || busy || !!built.error} onClick={() => save(false)}><Icon name="save" /> Enregistrer</button>
        <button className="btn primary" disabled={busy || !!built.error || (!dirty && !running)} onClick={() => save(true)} title={running ? 'Enregistre puis relance le service' : 'Le service est arrêté : enregistre seulement'}>
          <Icon name="bolt" /> Enregistrer et appliquer
        </button>
      </div>
    </div>
  );
}
