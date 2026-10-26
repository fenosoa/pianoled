"""Utilitaires audio : vérification de ffmpeg et conversion en WAV mono 16 kHz."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def check_ffmpeg() -> None:
    """Échoue avec un message clair si ffmpeg/ffprobe sont absents du PATH."""
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise RuntimeError(
                f"{tool} introuvable dans le PATH. Installe-le avec : "
                "winget install Gyan.FFmpeg  (puis rouvre le terminal)."
            )


def to_wav16k(src: Path, dst: Path, start: float = 0.0, duration: float | None = None) -> Path:
    """Convertit n'importe quelle entrée (mp3/mp4/wav…) en WAV mono 16 kHz."""
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-i", str(src)]
    if duration is not None:
        cmd += ["-t", str(duration)]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", str(dst)]
    subprocess.run(cmd, check=True)
    return dst


def duration_of(path: Path) -> float:
    """Durée en secondes (ffprobe)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return float(out.stdout.strip())
