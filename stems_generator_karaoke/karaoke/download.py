"""Étape 1 : récupération de l'audio (YouTube ou MP3 local).

Les deux fonctions renvoient le dossier de la chanson (songs/<slug>/), qui contient
<slug>.mp3 et <slug>.meta.json. Si le dossier existe déjà pour la même source, il est réutilisé.
"""
import shutil
from pathlib import Path

from . import meta as M


def download_youtube(url: str, out_dir: Path, force: bool = False) -> Path:
    import yt_dlp

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    song_dir = M.find_existing(out_dir, youtube_url=url)
    if song_dir and not force and M.read_meta(song_dir)["status"]["mp3"] == "ok" and M.audio_path(song_dir).exists():
        return song_dir

    base_opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    with yt_dlp.YoutubeDL(base_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    title = info.get("title") or url

    if song_dir is None:
        slug = M.unique_slug(title, out_dir)
        song_dir = out_dir / slug
        song_dir.mkdir(parents=True)
        meta = M.new_meta(slug, title, "youtube", youtube_url=url)
    else:
        meta = M.read_meta(song_dir)
    meta["status"]["mp3"] = "error"
    M.write_meta(song_dir, meta)

    opts = {
        **base_opts,
        "format": "bestaudio/best",
        "outtmpl": str(song_dir / (song_dir.name + ".%(ext)s")),
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"}
        ],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    if not M.audio_path(song_dir).exists():
        raise RuntimeError("MP3 absent après téléchargement")
    meta["duration"] = round(float(info.get("duration") or _duration(M.audio_path(song_dir))), 2)
    meta["status"]["mp3"] = "ok"
    M.write_meta(song_dir, meta)
    return song_dir


def import_local(mp3_path: Path, out_dir: Path, force: bool = False) -> Path:
    from mutagen.mp3 import MP3

    mp3_path, out_dir = Path(mp3_path), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    origin = str(mp3_path.resolve())

    song_dir = M.find_existing(out_dir, local_file=origin)
    if song_dir and not force and M.read_meta(song_dir)["status"]["mp3"] == "ok" and M.audio_path(song_dir).exists():
        return song_dir

    title, artist = mp3_path.stem, None
    try:
        from mutagen.easyid3 import EasyID3

        tags = EasyID3(mp3_path)
        title = tags.get("title", [title])[0] or title
        artist = (tags.get("artist") or [None])[0]
    except Exception:
        pass  # pas de tags ID3 : on garde le nom de fichier

    if song_dir is None:
        slug = M.unique_slug(mp3_path.stem, out_dir)
        song_dir = out_dir / slug
        song_dir.mkdir(parents=True)
        meta = M.new_meta(slug, title, "local", local_file=origin)
    else:
        meta = M.read_meta(song_dir)
    if artist:
        meta["artist"] = artist
    meta["status"]["mp3"] = "error"
    M.write_meta(song_dir, meta)

    shutil.copy2(mp3_path, M.audio_path(song_dir))
    meta["duration"] = _duration(M.audio_path(song_dir))
    meta["status"]["mp3"] = "ok"
    M.write_meta(song_dir, meta)
    return song_dir


def _duration(path: Path) -> float:
    from mutagen.mp3 import MP3

    return round(MP3(path).info.length, 2)
