"""Jobs asynchrones : un seul alignement à la fois (GPU), progression lisible par polling."""
from __future__ import annotations

import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

_pool = ThreadPoolExecutor(max_workers=1)
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def submit(fn, *args) -> str:
    """fn(*args, progress) -> résultat ; progress(frac, message)."""
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "status": "queued", "progress": 0.0, "message": "En attente", "error": None}
    with _lock:
        _jobs[job_id] = job

    def progress(frac: float, msg: str) -> None:
        job.update(progress=round(frac, 2), message=msg)

    def work() -> None:
        job.update(status="running")
        try:
            job["result"] = fn(*args, progress)
            job.update(status="done", progress=1.0, message="Terminé")
        except Exception as e:  # noqa: BLE001 - remonté tel quel à l'UI
            traceback.print_exc()
            job.update(status="error", error=str(e), message="Erreur")

    _pool.submit(work)
    return job_id


def get(job_id: str) -> dict | None:
    return _jobs.get(job_id)
