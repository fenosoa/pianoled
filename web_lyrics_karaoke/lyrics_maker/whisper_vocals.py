"""Transcrit tous les vocals.flac de piano_stems_output avec faster-whisper.

Pour chaque répertoire <slug>/ :
  - lit <slug>.meta.json -> champ "language"
  - fr / en : transcrit vocals.flac -> <slug>.whisper.txt (même répertoire)
  - mg (malgache) ou autre : ignoré

Usage:
  python whisper_vocals.py [--root DIR] [--model large-v3] [--force] [--device cuda|cpu]
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "web_chords_karaoke" / "piano_stems_output"
SUPPORTED = {"fr", "en"}


def add_cuda_dlls():
    """ctranslate2 veut cublas/cudnn CUDA 12 : pip install nvidia-cublas-cu12 nvidia-cudnn-cu12."""
    import os
    try:
        import nvidia
    except ImportError:
        return
    for base in nvidia.__path__:
        for b in Path(base).glob("*/bin"):
            os.add_dll_directory(str(b))
            os.environ["PATH"] = str(b) + os.pathsep + os.environ["PATH"]


def main():
    add_cuda_dlls()
    ap =argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--compute-type", default=None)
    ap.add_argument("--force", action="store_true", help="refait même si .whisper.txt existe")
    args = ap.parse_args()

    jobs = []
    for d in sorted(p for p in args.root.iterdir() if p.is_dir()):
        vocals = d / "vocals.flac"
        meta = d / f"{d.name}.meta.json"
        if not vocals.exists() or not meta.exists():
            continue
        lang = json.loads(meta.read_text(encoding="utf-8")).get("language")
        if lang not in SUPPORTED:
            print(f"[skip] {d.name} (language={lang})")
            continue
        out = d / f"{d.name}.whisper.txt"
        if out.exists() and not args.force:
            print(f"[done] {d.name}")
            continue
        jobs.append((vocals, out, lang))

    print(f"{len(jobs)} fichier(s) à transcrire")
    if not jobs:
        return

    from faster_whisper import WhisperModel

    compute = args.compute_type or ("float16" if args.device == "cuda" else "int8")
    model = WhisperModel(args.model, device=args.device, compute_type=compute)

    for i, (vocals, out, lang) in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] {vocals.parent.name} ({lang})", flush=True)
        try:
            segments, _ = model.transcribe(
                str(vocals),
                language=lang,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            lines = [s.text.strip() for s in segments if s.text.strip()]
            out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except Exception as e:  # on continue avec les suivants
            print(f"  ERREUR: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
