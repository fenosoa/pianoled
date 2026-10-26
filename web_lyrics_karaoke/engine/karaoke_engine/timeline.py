"""Construction du lyrics.json et des exports (json / lrc / lrc-words)."""
from __future__ import annotations

from .lyrics_parse import Block


def build(blocks: list[Block], aligned: list[dict]) -> dict:
    """Redistribue les mots alignés (même ordre que le texte) dans sections/lignes."""
    it = iter(aligned)
    sections = []
    for b in blocks:
        lines = []
        for ln in b.lines:
            words = [next(it) for _ in ln]
            lines.append({"start": words[0]["start"], "end": words[-1]["end"], "words": words})
        sections.append({"type": b.type, "lines": lines})
    return {"version": 1, "offset": 0.0, "sections": sections}


def _lines(lyrics: dict):
    for s in lyrics["sections"]:
        yield from s["lines"]


def _stamp(t: float) -> str:
    m, s = divmod(max(t, 0.0), 60)
    return f"{int(m):02d}:{s:05.2f}"


def to_lrc(lyrics: dict, words: bool = False) -> str:
    """LRC par ligne, ou LRC enrichi (<mm:ss.xx> avant chaque mot) si words=True."""
    off = lyrics.get("offset", 0.0)
    out = []
    for ln in _lines(lyrics):
        if words:
            body = " ".join(f"<{_stamp(w['start'] + off)}>{w['t']}" for w in ln["words"])
            body += f" <{_stamp(ln['end'] + off)}>"
        else:
            body = " ".join(w["t"] for w in ln["words"])
        out.append(f"[{_stamp(ln['start'] + off)}]{body}")
    return "\n".join(out) + "\n"
