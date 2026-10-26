"""Étape 1 : validation de l'alignement en ligne de commande.

Usage : python align_cli.py voix.mp3 paroles.txt --start 0 --duration 30 -o out.json
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from karaoke_engine.audio import check_ffmpeg, to_wav16k
from karaoke_engine.aligner import align_words


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", type=Path)
    ap.add_argument("lyrics", type=Path, help="texte des paroles correspondant à l'extrait")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("-o", "--out", type=Path, default=Path("align_out.json"))
    a = ap.parse_args()

    check_ffmpeg()
    words = a.lyrics.read_text(encoding="utf-8").split()
    with tempfile.TemporaryDirectory() as tmp:
        wav = to_wav16k(a.audio, Path(tmp) / "a.wav", a.start, a.duration)
        result = align_words(wav, words)
    # Les temps sont relatifs à l'extrait ; on les recale sur le fichier d'origine.
    for w in result:
        w["start"] = round(w["start"] + a.start, 2)
        w["end"] = round(w["end"] + a.start, 2)
    a.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(result)} mots alignés -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
