"""API FastAPI du moteur. Lancement : uvicorn karaoke_engine.main:app --host 0.0.0.0 --port 8000"""
from __future__ import annotations

import mimetypes
import re
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from . import jobs, pipeline, store, timeline
from .audio import check_ffmpeg


@asynccontextmanager
async def lifespan(_: FastAPI):
    check_ffmpeg()                      # message clair si ffmpeg manque
    store.SONGS_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Karaoke Studio engine", lifespan=lifespan)


def _meta_or_404(song_id: str) -> dict:
    try:
        return store.get_meta(song_id)
    except KeyError:
        raise HTTPException(404, "Chanson introuvable")


@app.post("/api/songs")
async def create_song(
    audio: UploadFile = File(...),
    vocals: UploadFile | None = File(None),
    lyrics: UploadFile | None = File(None),
    lyrics_text: str | None = Form(None),
    title: str = Form(""),
    artist: str = Form(""),
):
    """Crée la chanson et lance l'alignement. Cache : mêmes fichiers => même id, pas de recalcul."""
    audio_b = await audio.read()
    vocals_b = await vocals.read() if vocals and vocals.filename else b""
    if lyrics and lyrics.filename:
        text = (await lyrics.read()).decode("utf-8-sig")
    elif lyrics_text:
        text = lyrics_text
    else:
        raise HTTPException(400, "Paroles manquantes (fichier `lyrics` ou texte `lyrics_text`).")

    text = "\n".join(text.splitlines())    # fins de ligne normalisees (evite \r\r\n sous Windows)
    song_id = store.hash_inputs(audio_b, vocals_b, text.encode("utf-8"))
    d = store.song_dir(song_id)
    if (d / "lyrics.json").exists():
        return {"song_id": song_id, "job_id": None, "cached": True}

    d.mkdir(parents=True, exist_ok=True)
    for old in list(d.glob("audio.*")) + list(d.glob("vocals.*")):
        old.unlink()
    (d / f"audio{Path(audio.filename).suffix.lower() or '.mp3'}").write_bytes(audio_b)
    if vocals_b:
        (d / f"vocals{Path(vocals.filename).suffix.lower() or '.mp3'}").write_bytes(vocals_b)
    (d / "paroles.txt").write_bytes(text.encode("utf-8"))
    store.write_json(d / "meta.json", {
        "id": song_id,
        "title": title or Path(audio.filename).stem,
        "artist": artist,
        "created": datetime.now().isoformat(timespec="seconds"),
        "has_vocals": bool(vocals_b),
        "status": "processing",
        "warnings": [],
    })
    return {"song_id": song_id, "job_id": jobs.submit(pipeline.run, song_id), "cached": False}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job introuvable")
    return {k: v for k, v in job.items() if k != "result"}


@app.get("/api/songs")
def list_songs():
    return store.list_songs()


@app.get("/api/songs/{song_id}")
def get_song(song_id: str):
    meta = _meta_or_404(song_id)
    lp = store.song_dir(song_id) / "lyrics.json"
    return {**meta, "lyrics": store.read_json(lp) if lp.exists() else None}


@app.get("/api/songs/{song_id}/audio")
def get_audio(song_id: str, stem: str = "audio"):
    """stem=audio (lecture) ou stem=vocals (voix seule, éditeur). FileResponse gère Range => seek."""
    _meta_or_404(song_id)
    if stem not in ("audio", "vocals"):
        raise HTTPException(400, "stem invalide")
    p = store.find_audio(song_id, stem)
    if not p:
        raise HTTPException(404, "Fichier audio introuvable")
    return FileResponse(p, media_type=mimetypes.guess_type(p.name)[0] or "audio/mpeg")


@app.put("/api/songs/{song_id}/lyrics")
def put_lyrics(song_id: str, lyrics: dict = Body(...)):
    _meta_or_404(song_id)
    if lyrics.get("version") != 1 or not isinstance(lyrics.get("sections"), list):
        raise HTTPException(422, "lyrics.json invalide")
    store.write_json(store.song_dir(song_id) / "lyrics.json", lyrics)
    return {"ok": True}


@app.get("/api/songs/{song_id}/export")
def export(song_id: str, format: str = "json"):
    meta = _meta_or_404(song_id)
    lp = store.song_dir(song_id) / "lyrics.json"
    if not lp.exists():
        raise HTTPException(409, "Alignement non terminé")
    lyrics = store.read_json(lp)
    name = re.sub(r"[^\w\-]+", "_", meta["title"]) or song_id
    if format == "json":
        return JSONResponse(lyrics, headers={"Content-Disposition": f'attachment; filename="{name}.json"'})
    if format in ("lrc", "lrc-words"):
        body = timeline.to_lrc(lyrics, words=(format == "lrc-words"))
        return PlainTextResponse(body, headers={"Content-Disposition": f'attachment; filename="{name}.lrc"'})
    raise HTTPException(400, "format : json | lrc | lrc-words")
