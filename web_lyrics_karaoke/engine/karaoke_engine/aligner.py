"""Alignement forcé mot par mot (ctc-forced-aligner, modèle MMS, langue mlg)."""
from __future__ import annotations

import math
from pathlib import Path

LANGUAGE = "mlg"  # malgache (code ISO 639-3 attendu par MMS)

_model = None
_tokenizer = None


def _device():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load():
    """Charge le modèle une seule fois (GPU auto-détecté)."""
    global _model, _tokenizer
    if _model is None:
        import torch
        from ctc_forced_aligner import load_alignment_model
        dev = _device()
        dtype = torch.float16 if dev == "cuda" else torch.float32
        _model, _tokenizer = load_alignment_model(dev, dtype=dtype)
    return _model, _tokenizer


def align_words(wav_path: Path, words: list[str], language: str = LANGUAGE) -> list[dict]:
    """Aligne `words` (mots tels qu'affichés) sur le WAV 16 kHz.

    Retourne une liste de {t, start, end, c} (c = exp(log-proba moyenne), dans [0,1]) de même longueur et même ordre que `words` :
    la correspondance mot affiché <-> mot aligné est conservée par index, car on passe
    à l'aligneur le texte joint par des espaces (1 mot = 1 entrée).
    """
    from ctc_forced_aligner import (
        generate_emissions, get_alignments, get_spans,
        load_audio, postprocess_results, preprocess_text,
    )
    model, tokenizer = _load()
    audio = load_audio(str(wav_path), model.dtype, model.device)
    emissions, stride = generate_emissions(model, audio, 30, 2, 4)

    # Un mot affiché peut contenir un espace (token « - » ou « ♪ » collé au voisin) :
    # on le soude pour que l'aligneur ne le recoupe pas (1 mot = 1 entrée).
    text = " ".join("".join(w.split()) for w in words)
    tokens_starred, text_starred = preprocess_text(text, True, language, "word", "edges")
    segments, scores, blank = get_alignments(emissions, tokens_starred, tokenizer)
    spans = get_spans(tokens_starred, segments, blank)
    results = postprocess_results(text_starred, spans, stride, scores)

    if len(results) != len(words):
        raise RuntimeError(
            f"Alignement incohérent : {len(words)} mots attendus, {len(results)} obtenus "
            "(un mot contient probablement uniquement des caractères non romanisables)."
        )
    return [
        {"t": w, "start": round(r["start"], 2), "end": round(r["end"], 2),
         "c": round(math.exp(float(r.get("score", -20.0))), 2)}
        for w, r in zip(words, results)
    ]
