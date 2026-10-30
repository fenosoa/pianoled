"""Post-traitement des *.lyrics.json : corrige les premiers mots collés dans les vides.

L'aligneur colle chaque ligne à la fin de la précédente : après un vide (intro, pont instrumental),
le premier mot démarre au début du silence et le dernier mot de la ligne précédente s'étire dessus.
Trois corrections, à partir du stem vocal (vocals.flac à côté du JSON) :
  1. détection des vides : le 1er mot d'une ligne démarre dans le silence vocal
  2. recalage de son start sur le premier onset réel de la voix
  3. plafonnement de la durée des mots : fin rognée à la dernière énergie vocale
     (sans stem : plafond fixe MAX_WORD_NO_STEM)

Usage : python fix_lyrics_gaps.py <dossier|fichier.lyrics.json> [...] [--dry-run]
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HOP = 0.02            # pas de l'enveloppe (s)
GAP_MIN = 0.8         # silence vocal à partir du start qui déclenche le recalage (s)
MIN_ACTIVE = 0.12     # durée minimale d'énergie continue pour compter comme un onset (s)
LONG_WORD = 1.0       # seuls les mots plus longs sont rognés (s)
TAIL_PAD = 0.15       # marge conservée après la dernière énergie vocale (s)
MAX_WORD_NO_STEM = 4.0


def activity(vocals_path):
    """Booléen par frame de HOP secondes : la voix est-elle présente ?"""
    y, sr = sf.read(str(vocals_path), dtype="float32")
    if y.ndim > 1:
        y = y.mean(1)
    h = int(sr * HOP)
    n = len(y) // h
    env = np.sqrt((y[: n * h].reshape(n, h) ** 2).mean(1))
    thr = max(np.percentile(env, 95) * 0.06, 1e-4)
    return env > thr


def first_onset(act, a, b):
    """Premier instant de [a, b) où la voix reste active MIN_ACTIVE secondes, sinon None."""
    need = int(MIN_ACTIVE / HOP)
    i, end = int(a / HOP), min(int(b / HOP), len(act))
    run = 0
    for k in range(i, end):
        run = run + 1 if act[k] else 0
        if run >= need:
            return (k - need + 1) * HOP
    return None


def last_active(act, a, b):
    """Dernier instant actif dans [a, b), sinon None."""
    for k in range(min(int(b / HOP), len(act)) - 1, int(a / HOP) - 1, -1):
        if act[k]:
            return (k + 1) * HOP
    return None


def fix(data, act):
    stats = {"shifted": 0, "trimmed": 0}
    lines = [l for s in data["sections"] for l in s.get("lines", []) if l.get("words")]
    lines.sort(key=lambda l: l["start"])
    for l in lines:
        w = l["words"]
        # 1+2 : premier mot dans un vide -> recalé sur l'onset vocal
        if act is not None:
            s0 = w[0]["start"]
            limit = w[1]["start"] if len(w) > 1 else w[0]["end"]
            if first_onset(act, s0, s0 + GAP_MIN) is None:
                onset = first_onset(act, s0, max(l["end"], w[-1]["end"]))
                if onset is not None and onset > s0 + HOP:
                    new = min(onset, limit - 0.05) if len(w) > 1 else onset
                    if new > s0:
                        w[0]["start"] = round(new, 2)
                        l["start"] = round(new, 2)
                        stats["shifted"] += 1
        # 3 : durée des mots plafonnée
        for x in w:
            dur = x["end"] - x["start"]
            if dur <= LONG_WORD:
                continue
            if act is not None:
                la = last_active(act, x["start"], x["end"])
                new_end = x["end"] if la is None else min(x["end"], la + TAIL_PAD)
                new_end = max(new_end, x["start"] + LONG_WORD)
            else:
                new_end = min(x["end"], x["start"] + MAX_WORD_NO_STEM)
            if new_end < x["end"] - HOP:
                x["end"] = round(new_end, 2)
                stats["trimmed"] += 1
        l["end"] = max(x["end"] for x in w)
    return stats


def main(argv):
    dry = "--dry-run" in argv
    files = []
    for a in argv:
        if a.startswith("--"):
            continue
        p = Path(a)
        files += [p] if p.is_file() else sorted(p.rglob("*.lyrics.json"))
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        vocals = f.parent / "vocals.flac"
        act = activity(vocals) if vocals.exists() else None
        st = fix(data, act)
        print(f"{f.parent.name[:60]:60} stem={'oui' if act is not None else 'non'} "
              f"recalés={st['shifted']} rognés={st['trimmed']}")
        if not dry:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
