import React, { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';

const time = (t) => new Date(t).toLocaleTimeString('fr-FR');

export function LogPanel({ logs, open, onToggle }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [logs, open]);

  return (
    <section className={`logs ${open ? 'open' : ''}`}>
      <button className="logs-head" onClick={onToggle}>
        <Icon name="terminal" /> Journal du service <small>{logs.length} lignes</small>
        <span className="grow" />
        <span className={`chev ${open ? 'up' : ''}`}><Icon name="chevron" /></span>
      </button>
      {open && (
        <pre ref={ref}>
          {logs.length === 0 && <span className="muted">Aucun log pour l’instant.</span>}
          {logs.map((l) => (
            <div key={l.id} className={`ln ${l.stream}`}>
              <span className="ts">{time(l.t)}</span> {l.line}
            </div>
          ))}
        </pre>
      )}
    </section>
  );
}
