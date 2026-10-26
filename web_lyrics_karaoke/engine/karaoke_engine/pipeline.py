"""Pipeline d'alignement d'une chanson, exécuté dans un job en arrière-plan."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Callable

from . import store, timeline
from .audio import duration_of, to_wav16k
from .lyrics_parse import detect_sections, flat_words, parse

DURATION_TOLERANCE = 0.10  # secondes


def run(song_id: str, progress: Callable[[float, str], None]) -> dict:
    from .aligner import align_words   # import tardif : torch est lourd

    d = store.song_dir(song_id)
    meta = store.read_json(d / "meta.json")
    audio = store.find_audio(song_id, "audio")
    vocals = store.find_audio(song_id, "vocals")
    warnings: list[str] = []

    progress(0.05, "Lecture des paroles")
    blocks = parse((d / "paroles.txt").read_text(encoding="utf-8"))
    if not blocks:
        raise ValueError("Les paroles sont vides.")
    detect_sections(blocks)
    words = flat_words(blocks)

    if vocals:
        da, dv = duration_of(audio), duration_of(vocals)
        if abs(da - dv) > DURATION_TOLERANCE:
            warnings.append(
                f"Durées différentes : audio {da:.2f}s, voix {dv:.2f}s "
                f"(écart {abs(da - dv) * 1000:.0f} ms > 100 ms). Le stem est peut-être décalé."
            )
        source = vocals
    else:
        warnings.append("Pas de stem voix : alignement sur le mix, moins précis.")
        source = audio

    progress(0.15, "Conversion en WAV 16 kHz")
    with tempfile.TemporaryDirectory() as tmp:
        wav = to_wav16k(source, Path(tmp) / "a.wav")
        progress(0.3, "Alignement (modèle MMS, mlg)")
        aligned = align_words(wav, words)

    progress(0.95, "Construction du lyrics.json")
    store.write_json(d / "lyrics.json", timeline.build(blocks, aligned))
    meta.update(status="done", warnings=warnings, words=len(words))
    store.write_json(d / "meta.json", meta)
    return meta
