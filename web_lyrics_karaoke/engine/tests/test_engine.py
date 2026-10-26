"""Tests : parsing/sections (rapides) + bout en bout API (nécessite KARAOKE_TEST_AUDIO/VOCALS/LYRICS).

Lancer : python -m pytest tests -q
E2E    : set KARAOKE_TEST_AUDIO=...mp3 ; set KARAOKE_TEST_LYRICS=...txt ; (optionnel KARAOKE_TEST_VOCALS)
         L'audio et les paroles doivent correspondre (idéalement un extrait court découpé avec ffmpeg).
"""
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from karaoke_engine import lyrics_parse as lp
from karaoke_engine import store, timeline


def test_detect_sections_auto():
    text = "A b\nc d\n\nE f\n\nA b\nc d\n"
    blocks = lp.parse(text)
    lp.detect_sections(blocks)
    assert [b.type for b in blocks] == ["refrain", "couplet", "refrain"]


def test_normalize_ignores_case_accents_punct():
    assert lp.normalize("Ô, Tiako!") == lp.normalize("o tiako")


def test_tags_override_and_apply_to_next_block_only():
    blocks = lp.parse("[pont]\nUn deux\n\nTrois quatre\n")
    lp.detect_sections(blocks)
    assert [b.type for b in blocks] == ["pont", "couplet"]


def test_punctuation_token_glued_to_neighbor():
    assert lp.parse("Tiako - ianao")[0].lines == [["Tiako -", "ianao"]]


def test_unknown_tag_rejected():
    with pytest.raises(ValueError):
        lp.parse("[bridge]\nx")


def test_lrc_formats():
    words = [{"t": "a", "start": 61.5, "end": 62.0, "c": 1}, {"t": "b", "start": 62.0, "end": 63.25, "c": 1}]
    ly = {"offset": 0.0, "sections": [{"type": "couplet", "lines": [{"start": 61.5, "end": 63.25, "words": words}]}]}
    assert timeline.to_lrc(ly) == "[01:01.50]a b\n"
    assert timeline.to_lrc(ly, words=True) == "[01:01.50]<01:01.50>a <01:02.00>b <01:03.25>\n"


@pytest.mark.skipif(not os.environ.get("KARAOKE_TEST_AUDIO"), reason="E2E: fournir KARAOKE_TEST_AUDIO/LYRICS")
def test_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "SONGS_DIR", tmp_path)
    from karaoke_engine.main import app

    audio = Path(os.environ["KARAOKE_TEST_AUDIO"])
    vocals = os.environ.get("KARAOKE_TEST_VOCALS")
    lyrics = Path(os.environ["KARAOKE_TEST_LYRICS"])
    with TestClient(app) as c:
        files = {"audio": (audio.name, audio.read_bytes()), "lyrics": (lyrics.name, lyrics.read_bytes())}
        if vocals:
            files["vocals"] = (Path(vocals).name, Path(vocals).read_bytes())
        r = c.post("/api/songs", files=files, data={"title": "Test"})
        assert r.status_code == 200, r.text
        sid, job = r.json()["song_id"], r.json()["job_id"]

        for _ in range(600):
            j = c.get(f"/api/jobs/{job}").json()
            if j["status"] in ("done", "error"):
                break
            time.sleep(1)
        assert j["status"] == "done", j

        song = c.get(f"/api/songs/{sid}").json()
        sections = song["lyrics"]["sections"]
        words = [w for s in sections for ln in s["lines"] for w in ln["words"]]
        assert words and all(w["end"] >= w["start"] for w in words)
        assert all(a["start"] <= b["start"] for a, b in zip(words, words[1:]))

        # Range => seek
        part = c.get(f"/api/songs/{sid}/audio", headers={"Range": "bytes=0-99"})
        assert part.status_code == 206 and len(part.content) == 100

        assert c.get(f"/api/songs/{sid}/export?format=lrc-words").text.startswith("[")
        assert c.put(f"/api/songs/{sid}/lyrics", json=song["lyrics"]).json() == {"ok": True}
        # Cache : même envoi => pas de nouveau job
        assert c.post("/api/songs", files=files, data={"title": "Test"}).json()["cached"] is True
