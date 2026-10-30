"""Aligne vocals.flac + <slug>.whisper.txt -> <slug>.lyrics.json (moteur karaoke_engine).

Pour chaque répertoire <slug>/ de piano_stems_output ayant vocals.flac, <slug>.whisper.txt
et <slug>.meta.json (champ "language" : fr / en ; le malgache et le reste sont ignorés) :
  - parse les paroles (1 ligne whisper = 1 ligne de karaoke, blocs de LINES_PER_BLOCK lignes)
  - aligne mot à mot (ctc-forced-aligner / MMS) sur la voix
  - écrit <slug>.lyrics.json, même format que songs/<id>/lyrics.json

Usage:
  python align_lyrics.py [--root DIR] [--force]
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "engine"))

DEFAULT_ROOT = HERE.parents[1] / "web_chords_karaoke" / "piano_stems_output"
LANG_ISO3 = {"fr": "fra", "en": "eng"}   # codes attendus par MMS / uroman
LINES_PER_BLOCK = 4


def to_blocks(text: str):
    from karaoke_engine.lyrics_parse import Block, _split_words, detect_sections

    blocks, cur = [], None
    for line in (ln.strip() for ln in text.splitlines()):
        words = _split_words(line) if line else []
        if not words:
            continue
        if cur is None or len(cur.lines) >= LINES_PER_BLOCK:
            cur = Block(lines=[])
            blocks.append(cur)
        cur.lines.append(words)
        cur.texts.append(line)
    detect_sections(blocks)
    return blocks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    ap.add_argument("--force", action="store_true", help="refait même si .lyrics.json existe")
    a = ap.parse_args()

    from karaoke_engine import timeline
    from karaoke_engine.audio import check_ffmpeg, to_wav16k
    from karaoke_engine.lyrics_parse import flat_words

    jobs = []
    for d in sorted(p for p in a.root.iterdir() if p.is_dir()):
        slug = d.name
        vocals, txt, meta = d / "vocals.flac", d / f"{slug}.whisper.txt", d / f"{slug}.meta.json"
        out = d / f"{slug}.lyrics.json"
        if not (vocals.exists() and txt.exists() and meta.exists()):
            continue
        lang = json.loads(meta.read_text(encoding="utf-8")).get("language")
        if lang not in LANG_ISO3:
            print(f"[skip] {slug} (language={lang})")
            continue
        if out.exists() and not a.force:
            print(f"[done] {slug}")
            continue
        jobs.append((slug, vocals, txt, out, LANG_ISO3[lang]))

    print(f"{len(jobs)} fichier(s) à aligner")
    if not jobs:
        return 0
    check_ffmpeg()
    from karaoke_engine.aligner import align_words   # import tardif : torch est lourd

    for i, (slug, vocals, txt, out, lang) in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] {slug} ({lang})", flush=True)
        try:
            blocks = to_blocks(txt.read_text(encoding="utf-8"))
            if not blocks:
                print("  paroles vides, ignoré")
                continue
            words = flat_words(blocks)
            with tempfile.TemporaryDirectory() as tmp:
                wav = to_wav16k(vocals, Path(tmp) / "a.wav")
                aligned = align_words(wav, words, language=lang)
            out.write_text(
                json.dumps(timeline.build(blocks, aligned), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:  # on continue avec les suivants
            print(f"  ERREUR: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
