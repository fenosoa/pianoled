import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useServerEvents } from './api.js';
import { Field } from './Field.jsx';
import { Icon } from './Icon.jsx';
import { LogPanel } from './LogPanel.jsx';
import { NoteMapEditor } from './NoteMapEditor.jsx';

const STATE_LABEL = {
  running: 'En marche',
  starting: 'Démarrage…',
  stopping: 'Arrêt…',
  stopped: 'Arrêté',
  crashed: 'Plantage',
};

function visible(field, values) {
  if (field.hidden) return false;
  return !field.showIf || Object.entries(field.showIf).every(([k, v]) => values[k] === v);
}

export default function App() {
  const [schema, setSchema] = useState(null);
  const [saved, setSaved] = useState({});
  const [draft, setDraft] = useState({});
  const [group, setGroup] = useState('ddp');
  const [ports, setPorts] = useState({ inputs: [], outputs: [], error: null });
  const [check, setCheck] = useState({ ok: true, warnings: [] });
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [autoApply, setAutoApply] = useState(() => localStorage.getItem('autoApply') === '1');
  const [query, setQuery] = useState('');
  const [logsOpen, setLogsOpen] = useState(true);
  const { status, logs } = useServerEvents();

  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([api('/api/schema'), api('/api/env')]);
    setSchema(s);
    setSaved(e.values);
    setDraft(e.values);
  }, []);
  const refreshPorts = useCallback(() => api('/api/ports').then(setPorts).catch(() => {}), []);

  useEffect(() => {
    load().catch((e) => notify(e.message, 'err'));
    refreshPorts();
  }, [load, refreshPorts, notify]);

  const changed = useMemo(() => Object.keys(draft).filter((k) => draft[k] !== saved[k]), [draft, saved]);
  const dirty = changed.length > 0;

  // Live validation with the very same loader as the service.
  useEffect(() => {
    if (!schema) return undefined;
    const t = setTimeout(() => api('/api/validate', { values: draft }).then(setCheck).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [draft, schema]);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: String(value) }));

  const run = async (name, fn, okMsg) => {
    setBusy(name);
    try {
      const r = await fn();
      if (okMsg) notify(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return r;
    } catch (e) {
      notify(e.message, 'err');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = () => run('save', async () => { await api('/api/env', { values: draft }, 'PUT'); setSaved(draft); }, 'Configuration enregistrée (.env)');
  const apply = useCallback(
    () =>
      run(
        'apply',
        async () => {
          const r = await api('/api/apply', { values: draft });
          setSaved(draft);
          return r;
        },
        (r) => `Appliqué : service relancé en ${r.ms} ms`
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft]
  );
  const revert = () => setDraft(saved);

  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    localStorage.setItem('autoApply', autoApply ? '1' : '0');
    if (!autoApply || !dirty || !check.ok || busy) return undefined;
    const t = setTimeout(() => applyRef.current(), 900);
    return () => clearTimeout(t);
  }, [autoApply, dirty, check.ok, draft, busy]);

  const ctl = (name, path, okMsg) => run(name, () => api(path, {}), okMsg);

  if (!schema) return <div className="boot">Chargement…</div>;

  const state = status?.state || 'stopped';
  const q = query.trim().toLowerCase();
  const matches = (f) => !q || `${f.label} ${f.key} ${f.help}`.toLowerCase().includes(q);
  const fieldsOf = (g) => schema.fields.filter((f) => f.group === g && visible(f, draft));
  const current = schema.groups.find((g) => g.id === group) || schema.groups[0];
  const shown = q
    ? schema.fields.filter((f) => visible(f, draft) && matches(f))
    : fieldsOf(group);
  const dirtyIn = (g) => changed.filter((k) => schema.fields.find((f) => f.key === k)?.group === g).length;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo"><i /><i /><i /><i /></span>
          <div>
            <h1>PianoLed</h1>
            <small>Panneau de contrôle</small>
          </div>
        </div>
        <div className={`pill ${state}`}><span className="dot" />{STATE_LABEL[state]}{status?.pid ? <em>pid {status.pid}</em> : null}</div>
        <div className="actions">
          <button className="btn ghost" disabled={!!busy || state === 'running' || state === 'starting'} onClick={() => ctl('start', '/api/start', 'Service démarré')}>
            <Icon name="play" /> Démarrer
          </button>
          <button className="btn ghost" disabled={!!busy || !status?.pid} onClick={() => ctl('restart', '/api/restart', 'Service relancé')}>
            <Icon name="refresh" /> Relancer
          </button>
          <button className="btn ghost" disabled={!!busy || !status?.pid} onClick={() => ctl('stop', '/api/stop', 'Service arrêté')}>
            <Icon name="stop" /> Arrêter
          </button>
          <button className="btn danger" disabled={!status?.pid || state !== 'running'} onClick={() => ctl('panic', '/api/panic', 'Panic : LEDs éteintes')} title="Éteint toutes les LEDs sans arrêter le service">
            <Icon name="bolt" /> Panic
          </button>
        </div>
      </header>

      <div className="body">
        <nav className="side">
          <label className="search">
            <Icon name="search" />
            <input placeholder="Rechercher un paramètre…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {schema.groups.map((g) => (
            <button key={g.id} className={`nav ${!q && g.id === group ? 'on' : ''}`} onClick={() => { setQuery(''); setGroup(g.id); }}>
              <Icon name={g.icon} />
              <span>{g.label}</span>
              {dirtyIn(g.id) > 0 && <b className="badge">{dirtyIn(g.id)}</b>}
            </button>
          ))}
          <button className={`nav ${!q && group === '__map' ? 'on' : ''}`} onClick={() => { setQuery(''); setGroup('__map'); }}>
            <Icon name="table" />
            <span>Table des notes</span>
          </button>
        </nav>

        <main className="main">
        {group === '__map' && !q ? (
          <NoteMapEditor notify={notify} mappingMode={draft.MAPPING_MODE} running={state === 'running'} onUseTable={() => set('MAPPING_MODE', 'table')} />
        ) : (<>
          <div className="head">
            <h2>{q ? `Résultats pour « ${query} »` : current.label}</h2>
            <p>{q ? `${shown.length} paramètre(s)` : current.hint}</p>
          </div>
          {group === 'midi' && !q && (
            <div className="ports">
              <span>
                {ports.error
                  ? `Ports non détectés : ${ports.error.slice(0, 90)}`
                  : `${ports.inputs.length} entrée(s), ${ports.outputs.length} sortie(s) détectées`}
              </span>
              <button className="btn ghost sm" onClick={refreshPorts}><Icon name="refresh" /> Actualiser</button>
            </div>
          )}
          <div className="cards">
            {shown.map((f) => (
              <Field key={f.key} field={f} value={draft[f.key] ?? ''} changed={draft[f.key] !== saved[f.key]} onChange={(v) => set(f.key, v)} onReset={() => set(f.key, f.def)} ports={ports} />
            ))}
            {!shown.length && <div className="empty">Aucun paramètre.</div>}
          </div>
        </>)}
        </main>
      </div>

      <LogPanel logs={logs} open={logsOpen} onToggle={() => setLogsOpen((o) => !o)} />

      <footer className={`bar ${dirty ? 'show' : ''}`}>
        <div className="msg">
          {!check.ok ? <span className="bad"><Icon name="alert" /> {check.error}</span>
            : check.warnings?.length ? <span className="warn"><Icon name="alert" /> {check.warnings[0]}</span>
            : <span>{changed.length} modification(s) non appliquée(s)</span>}
        </div>
        <label className="switch-row" title="Enregistre et relance automatiquement 0,9 s après la dernière modification valide">
          <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
          <span>Appliquer automatiquement</span>
        </label>
        <button className="btn ghost" onClick={revert} disabled={!!busy}>Annuler</button>
        <button className="btn" onClick={save} disabled={!!busy || !check.ok}>Enregistrer</button>
        <button className="btn primary" onClick={apply} disabled={!!busy || !check.ok}>
          <Icon name="bolt" /> {busy === 'apply' ? 'Application…' : 'Appliquer maintenant'}
        </button>
      </footer>

      {toast && <div className={`toast ${toast.kind}`} key={toast.id}>{toast.msg}</div>}
    </div>
  );
}
