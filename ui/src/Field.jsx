import React from 'react';
import { Icon } from './Icon.jsx';

const NAMED = {
  white: '#ffffff', green: '#00ff00', blue: '#0000ff', red: '#ff0000', cyan: '#00ffff', yellow: '#ffc800', synthesia: '#00cff5',
};

// "#rrggbb" | "r,g,b" | name -> "#rrggbb" (or null when unparsable)
export function toHex(v) {
  const s = String(v).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(s);
  if (m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255)) {
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function Control({ field, value, onChange, ports }) {
  const { type } = field;

  if (type === 'bool') {
    const on = /^(1|true|yes|on)$/i.test(value);
    return (
      <button type="button" role="switch" aria-checked={on} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(on ? '0' : '1')}>
        <span /> <em>{on ? 'Activé' : 'Désactivé'}</em>
      </button>
    );
  }

  if (type === 'enum') {
    return (
      <div className="seg">
        {field.options.map((o) => (
          <button type="button" key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
        ))}
      </div>
    );
  }

  if (type === 'color') {
    const hex = toHex(value);
    return (
      <div className="colorrow">
        <label className="swatch" style={{ background: hex || 'transparent' }} title="Choisir une couleur">
          <input type="color" value={hex || '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
        <input className={`in ${hex ? '' : 'invalid'}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder="#RRGGBB ou r,g,b" />
      </div>
    );
  }

  if (type === 'int' && field.hot) {
    const n = Number(value === '' ? field.def : value) || 0;
    const set = (v) => onChange(String(Math.min(field.max, Math.max(field.min, v))));
    return (
      <div className="stepper">
        <button type="button" className="btn sm" onClick={() => set(n - 1)} disabled={n <= field.min} aria-label={`${field.label} : diminuer`}>▼</button>
        <input className="in num" type="number" min={field.min} max={field.max} step="1" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn sm" onClick={() => set(n + 1)} disabled={n >= field.max} aria-label={`${field.label} : augmenter`}>▲</button>
        {field.unit && <span className="unit">{field.unit}</span>}
      </div>
    );
  }

  if ((type === 'number' || type === 'int') && field.slider) {
    return (
      <div className="sliderrow">
        <input type="range" min={field.min} max={field.max} step={field.step || 1} value={value === '' ? field.def : value} onChange={(e) => onChange(e.target.value)} />
        <input className="in num" type="number" min={field.min} max={field.max} step={field.step || 1} value={value} onChange={(e) => onChange(e.target.value)} />
        {field.unit && <span className="unit">{field.unit}</span>}
      </div>
    );
  }

  if (type === 'number' || type === 'int') {
    return (
      <div className="numrow">
        <input className="in num" type="number" min={field.min} max={field.max} step={field.step || (type === 'int' ? 1 : 'any')} value={value} onChange={(e) => onChange(e.target.value)} />
        {field.unit && <span className="unit">{field.unit}</span>}
      </div>
    );
  }

  if (type === 'port-in' || type === 'port-out') {
    const list = type === 'port-in' ? ports.inputs : ports.outputs;
    const id = `ports-${field.key}`;
    const matched = value && list.find((n) => n.toLowerCase().includes(value.toLowerCase()));
    return (
      <div className="portrow">
        <input className="in" list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="(non défini)" spellCheck={false} />
        <datalist id={id}>{list.map((n) => <option key={n} value={n} />)}</datalist>
        {value ? <span className={`tag ${matched ? 'ok' : 'miss'}`}>{matched ? 'trouvé' : 'introuvable'}</span> : null}
        {list.length > 0 && (
          <select className="in pick" value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
            <option value="">Choisir…</option>
            {list.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </div>
    );
  }

  return <input className="in" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} spellCheck={false} />;
}

export function Field({ field, value, changed, onChange, onReset, ports }) {
  return (
    <div className={`card ${changed ? 'changed' : ''}`}>
      <div className="card-head">
        <div>
          <h3>{field.label}</h3>
          <code>{field.key}</code>
        </div>
        {value !== field.def && (
          <button className="reset" title={`Valeur par défaut : ${field.def || '(vide)'}`} onClick={onReset}>
            <Icon name="undo" size={14} />
          </button>
        )}
      </div>
      <Control field={field} value={value} onChange={onChange} ports={ports} />
      {field.help && <p className="help">{field.help}</p>}
    </div>
  );
}
