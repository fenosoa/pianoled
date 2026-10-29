"""
stems.py — Séparation en stems par lot pour le karaoké.

Passe 1 : MDX23C InstVoc HQ  (sur le MP3)   -> vocals, instrumental
Passe 2 : BS-Roformer SW     (sur l'instru) -> drums, bass, guitar, piano, other

Les MP3 sont cherchés récursivement dans --in. La sortie reproduit la même
arborescence dans --out (les .json à côté du MP3 sont copiés aussi) :

  songs\\adele_xxx\\adele_xxx.mp3      ->  stems\\adele_xxx\\{vocals,instrumental,drums,bass,guitar,piano,other}.flac
  songs\\adele_xxx\\chords.json        ->  stems\\adele_xxx\\chords.json

Chaque passe traite TOUS les morceaux avant la suivante (modèle chargé une seule
fois). Relançable : ce qui existe déjà est sauté.

Usage :
  python stems.py --in "C:\\...\\songs" --out "D:\\Karaoke\\stems" --models "C:\\...\\models" --limit 2
"""
import argparse
import logging
import shutil
import time
from pathlib import Path

from audio_separator.separator import Separator

FMT = "flac"
MDXC = dict(mdxc_params={"segment_size": 256, "overlap": 8, "batch_size": 1})

# (nom de passe, fichier modèle, source, {stem du modèle: nom final}, params)
PASSES = [
    ("1-voix", "MDX23C-8KFFT-InstVoc_HQ.ckpt", "mp3",
     {"Vocals": "vocals", "Instrumental": "instrumental"}, MDXC),
    ("2-instruments", "BS-Roformer-SW.ckpt", "instrumental",
     {"Drums": "drums", "Bass": "bass", "Guitar": "guitar",
      "Piano": "piano", "Other": "other"}, MDXC),
]


def out_dir_for(mp3: Path, inp: Path, out_root: Path) -> Path:
    """Même chemin relatif que le dossier du MP3."""
    return out_root / mp3.parent.relative_to(inp)


def copy_sidecars(mp3: Path, dest: Path):
    """Copie chords.json, .meta.json, etc. s'ils ne sont pas déjà là."""
    dest.mkdir(parents=True, exist_ok=True)
    for f in mp3.parent.glob("*.json"):
        target = dest / f.name
        if not target.exists() or f.stat().st_mtime > target.stat().st_mtime:
            shutil.copy2(f, target)


def run_pass(name, model, source, stems, params, songs, inp, out_root, models_dir, tmp):
    todo = []
    for mp3 in songs:
        song_dir = out_dir_for(mp3, inp, out_root)
        if all((song_dir / f"{s}.{FMT}").exists() for s in stems.values()):
            continue
        src = mp3 if source == "mp3" else song_dir / f"instrumental.{FMT}"
        if not src.exists():
            print(f"  [!] {mp3.parent.name} : source manquante ({src.name}), passe 1 ratée ?")
            continue
        todo.append((mp3, src, song_dir))

    print(f"\n=== Passe {name} ({model}) : {len(todo)} morceau(x) à traiter ===")
    if not todo:
        return []

    sep = Separator(
        output_dir=str(tmp),
        output_format=FMT.upper(),
        model_file_dir=str(models_dir),
        sample_rate=44100,
        log_level=logging.WARNING,
        **params,
    )
    sep.load_model(model_filename=model)

    failures = []
    for i, (mp3, src, song_dir) in enumerate(todo, 1):
        t0 = time.time()
        key = str(mp3.relative_to(inp).with_suffix("")).replace("\\", "_").replace("/", "_")
        try:
            song_dir.mkdir(parents=True, exist_ok=True)
            custom = {k: f"{key}__{v}" for k, v in stems.items()}
            outputs = sep.separate(str(src), custom_output_names=custom)
            for f in outputs:
                p = Path(f)
                if not p.is_absolute():
                    p = tmp / p
                # audio-separator collapse les "_" répétés : on compare sur le suffixe
                final = next((v for v in stems.values() if p.stem.endswith(f"_{v}")), None)
                if final:
                    shutil.move(str(p), song_dir / f"{final}.{FMT}")
                else:
                    p.unlink(missing_ok=True)  # stems non voulus
            print(f"  [{i}/{len(todo)}] {mp3.parent.name}  ({time.time() - t0:.0f}s)")
        except Exception as e:
            print(f"  [{i}/{len(todo)}] ÉCHEC {mp3.parent.name} : {e}")
            failures.append((name, mp3.parent.name, str(e)))
    return failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="dossier racine des chansons")
    ap.add_argument("--out", required=True, help="dossier racine de sortie (autre disque possible)")
    ap.add_argument("--models", required=True, help="dossier des modèles")
    ap.add_argument("--limit", type=int, default=0, help="ne traiter que N morceaux (test)")
    a = ap.parse_args()

    inp, out_root, models_dir = Path(a.inp).resolve(), Path(a.out).resolve(), Path(a.models)
    songs = sorted(p for p in inp.rglob("*.mp3") if out_root not in p.parents)
    if a.limit:
        songs = songs[: a.limit]
    print(f"{len(songs)} MP3 trouvés sous {inp}")

    for mp3 in songs:
        copy_sidecars(mp3, out_dir_for(mp3, inp, out_root))

    tmp = out_root / "_tmp"
    tmp.mkdir(parents=True, exist_ok=True)

    t_start, failures = time.time(), []
    for p in PASSES:
        failures += run_pass(*p, songs, inp, out_root, models_dir, tmp)

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\nTerminé en {(time.time() - t_start) / 60:.1f} min.")
    if failures:
        print(f"{len(failures)} échec(s) — relance le script pour réessayer :")
        for name, song, err in failures:
            print(f"  - [{name}] {song} : {err}")


if __name__ == "__main__":
    main()