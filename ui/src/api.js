import { useEffect, useState } from 'react';

/** GET when no body, POST (or the given method) with JSON otherwise. Throws a readable Error on failure. */
export async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const MAX_LOGS = 400;

/** Live service status + log lines over Server-Sent Events (auto-reconnect by the browser). */
export function useServerEvents() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api('/api/logs').then(setLogs).catch(() => {});
    const es = new EventSource('/api/events');
    es.addEventListener('status', (e) => setStatus(JSON.parse(e.data)));
    es.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data);
      setLogs((l) => (l.some((x) => x.id === entry.id) ? l : [...l, entry].slice(-MAX_LOGS)));
    });
    return () => es.close();
  }, []);

  return { status, logs };
}
