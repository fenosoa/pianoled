"""Lecture/écriture de <slug>.meta.json et génération de slugs."""
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

MAX_SLUG = 80
_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = _FORBIDDEN.sub(" ", text)
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_").lower()
    text = text[:MAX_SLUG].rstrip("_") or "song"
    if text in _RESERVED:
        text += "_"
    return text


def unique_slug(base: str, out_dir: Path) -> str:
    """Slug unique dans out_dir (suffixe _2, _3... en cas de collision), 80 caractères max."""
    base = slugify(base)
    slug, n = base, 1
    while (out_dir / slug).exists():
        n += 1
        suffix = f"_{n}"
        slug = base[: MAX_SLUG - len(suffix)] + suffix
    return slug


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def new_meta(slug: str, title: str, source: str, youtube_url=None, local_file=None) -> dict:
    return {
        "slug": slug,
        "title": title,
        "source": source,
        "youtube_url": youtube_url,
        "local_file": local_file,
        "duration": 0,
        "chordify_url": None,
        "status": {"mp3": "error", "chords": "pending"},
        "updated_at": now_iso(),
    }


def audio_path(song_dir: Path) -> Path:
    song_dir = Path(song_dir)
    return song_dir / f"{song_dir.name}.mp3"


def meta_path(song_dir: Path) -> Path:
    song_dir = Path(song_dir)
    return song_dir / f"{song_dir.name}.meta.json"


def migrate_names(out_dir: Path) -> None:
    """Renomme audio.mp3 / meta.json (ancien format) en <slug>.mp3 / <slug>.meta.json."""
    for d in out_dir.iterdir() if out_dir.exists() else []:
        if not d.is_dir():
            continue
        for old, new in (("audio.mp3", audio_path(d)), ("meta.json", meta_path(d))):
            if (d / old).exists() and not new.exists():
                (d / old).rename(new)


def read_meta(song_dir: Path) -> dict:
    return json.loads(meta_path(song_dir).read_text(encoding="utf-8"))


def write_meta(song_dir: Path, meta: dict) -> None:
    meta["updated_at"] = now_iso()
    meta_path(song_dir).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def find_existing(out_dir: Path, youtube_url=None, local_file=None) -> Path | None:
    """Retrouve le dossier d'une chanson déjà importée (pour l'idempotence)."""
    if not out_dir.exists():
        return None
    migrate_names(out_dir)
    for d in sorted(out_dir.iterdir()):
        if not meta_path(d).exists():
            continue
        try:
            m = read_meta(d)
        except (json.JSONDecodeError, OSError):
            continue
        if youtube_url and m.get("youtube_url") == youtube_url:
            return d
        if local_file and m.get("local_file") == local_file:
            return d
    return None
