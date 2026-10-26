"""Parsing du texte de paroles -> sections / lignes / mots, avec détection des refrains."""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

SECTION_TYPES = ("couplet", "refrain", "pont", "intro", "outro")
_TAG = re.compile(r"^\[([^\]]+)\]$")


@dataclass
class Block:
    """Un écran de paroles : lignes consécutives sans ligne vide."""
    lines: list[list[str]]            # lignes -> mots affichés
    type: str | None = None           # None = à détecter
    texts: list[str] = field(default_factory=list)


def normalize(s: str) -> str:
    """Casse, accents et ponctuation ignorés (pour comparer les lignes)."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _split_words(line: str) -> list[str]:
    """Mots par espaces ; un token sans lettre/chiffre (« - », « … ») est collé au mot voisin
    pour que l'aligneur ne perde jamais la correspondance mot affiché <-> mot aligné."""
    out: list[str] = []
    pending = ""
    for tok in line.split():
        if not any(c.isalnum() for c in tok):
            if out:
                out[-1] += " " + tok
            else:
                pending = (pending + " " + tok).strip()
            continue
        if pending:
            tok, pending = pending + " " + tok, ""
        out.append(tok)
    return out


def parse(text: str) -> list[Block]:
    blocks: list[Block] = []
    cur: Block | None = None
    tag: str | None = None
    for raw in text.splitlines():
        line = raw.strip().lstrip("﻿")
        if not line:
            cur = None
            continue
        m = _TAG.match(line)
        if m:
            name = normalize(m.group(1))
            if name not in SECTION_TYPES:
                raise ValueError(f"Balise inconnue [{m.group(1)}] (attendu : {', '.join(SECTION_TYPES)})")
            tag, cur = name, None
            continue
        words = _split_words(line)
        if not words:
            continue
        if cur is None:
            cur = Block(lines=[], type=tag)
            blocks.append(cur)
            tag = None   # la balise ne vaut que pour le bloc suivant
        cur.lines.append(words)
        cur.texts.append(line)
    return blocks


def detect_sections(blocks: list[Block]) -> None:
    """Sans balise : blocs répétés (ou composés de lignes qui reviennent) = refrain, sinon couplet."""
    line_count = Counter(normalize(t) for b in blocks for t in b.texts if normalize(t))
    block_key = [" | ".join(normalize(t) for t in b.texts) for b in blocks]
    block_count = Counter(block_key)
    for b, key in zip(blocks, block_key):
        if b.type:
            continue
        repeated = block_count[key] >= 2
        all_lines_repeat = len(b.texts) >= 2 and all(line_count[normalize(t)] >= 2 for t in b.texts)
        b.type = "refrain" if repeated or all_lines_repeat else "couplet"


def flat_words(blocks: list[Block]) -> list[str]:
    return [w for b in blocks for ln in b.lines for w in ln]
