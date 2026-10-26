"""Stockage des chansons : songs/<id>/{audio.*, vocals.*, paroles.txt, meta.json, lyrics.json}."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

SONGS_DIR = Path(os.environ.get("KARAOKE_SONGS_DIR", Path(__file__).resolve().parents[2] / "songs"))


def song_dir(song_id: str) -> Path:
    if not song_id.isalnum():          # évite tout path traversal
        raise KeyError(song_id)
    return SONGS_DIR / song_id


def hash_inputs(*chunks: bytes) -> str:
    h = hashlib.sha256()
    for c in chunks:
        h.update(hashlib.sha256(c).digest())
    return h.hexdigest()[:12]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_songs() -> list[dict]:
    SONGS_DIR.mkdir(parents=True, exist_ok=True)
    return [read_json(d / "meta.json") for d in sorted(SONGS_DIR.iterdir()) if (d / "meta.json").exists()]


def get_meta(song_id: str) -> dict:
    p = song_dir(song_id) / "meta.json"
    if not p.exists():
        raise KeyError(song_id)
    return read_json(p)


def find_audio(song_id: str, stem: str = "audio") -> Path | None:
    return next(song_dir(song_id).glob(f"{stem}.*"), None)
