"""Pipeline karaoké — étape 1 : MP3 + accords Chordify.

    python step1_chords.py login
    python step1_chords.py run --urls urls.txt --mp3-dir "D:\\Karaoke\\mp3"
"""
import argparse
import random
import sys
import time
from pathlib import Path

from karaoke import chordify, download
from karaoke import meta as M

HERE = Path(__file__).resolve().parent
PROFILE_DIR = HERE / ".chordify_profile"
SAMPLE = HERE / "samples" / "chords_example.json"


def log(status: str, slug: str, msg: str = "") -> None:
    print(f"{status:<4} {slug}  {msg}".rstrip())


def read_urls(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in lines if l.strip() and not l.strip().startswith("#")]


def step_mp3(sources: list[tuple[str, str]], out: Path, force: bool) -> list[Path]:
    """sources : [('youtube', url) | ('local', chemin)]. Retourne les dossiers de chansons réussis."""
    dirs = []
    failed: list[tuple[str, str, str]] = []
    for kind, src in sources:
        label = src if len(src) < 60 else src[:57] + "..."
        try:
            if kind == "youtube":
                d = download.download_youtube(src, out, force=force)
            else:
                d = download.import_local(Path(src), out, force=force)
            log("OK", d.name, "mp3")
            dirs.append(d)
        except Exception as e:  # noqa: BLE001
            log("ERR", label, f"mp3: {e}")
            _record_error(out, kind, src, e)
            failed.append((kind, src, str(e).strip().replace("\n", " ")))
    _log_failures(out, failed)
    return dirs


def _log_failures(out: Path, failed: list[tuple[str, str, str]]) -> None:
    """Ajoute les échecs mp3 à songs/_errors.log (une ligne par échec) et les récapitule."""
    if not failed:
        return
    stamp = M.now_iso()
    with (out / "_errors.log").open("a", encoding="utf-8") as f:
        for kind, src, err in failed:
            f.write(f"{stamp}\tmp3\t{kind}\t{src}\t{err}\n")
    print(f"\n{len(failed)} échec(s) mp3, détail dans {out / '_errors.log'} :")
    for _, src, _ in failed:
        print(f"  - {src}")


def _record_error(out: Path, kind: str, src: str, err: Exception) -> None:
    d = M.find_existing(out, youtube_url=src if kind == "youtube" else None,
                        local_file=str(Path(src).resolve()) if kind == "local" else None)
    if d:
        m = M.read_meta(d)
        m["status"]["mp3"] = "error"
        m["error"] = str(err)
        M.write_meta(d, m)


def step_chords(song_dirs: list[Path], force: bool, headless: bool) -> None:
    from playwright.sync_api import sync_playwright

    todo = []
    for d in song_dirs:
        m = M.read_meta(d)
        if m["status"]["mp3"] != "ok":
            log("SKIP", d.name, "chords (mp3 absent)")
        elif not force and m["status"]["chords"] == "ok" and (d / "chords.json").exists():
            log("SKIP", d.name, "chords déjà fait")
        else:
            todo.append(d)
    if not todo:
        return

    with sync_playwright() as p:
        ctx = chordify.open_context(p, PROFILE_DIR, headless=headless)
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            needs_login = any(M.read_meta(d)["source"] == "local" or M.read_meta(d).get("chordify_upload") for d in todo)
            if needs_login and not chordify.is_logged_in(page):
                chordify.close_context(ctx)
                sys.exit("Non connecté à Chordify (nécessaire pour l'upload). Lance d'abord : python step1_chords.py login")
            for i, d in enumerate(todo):
                if i:
                    time.sleep(random.uniform(3, 8))
                m = M.read_meta(d)
                try:
                    chordify.fetch_chords(d, page, SAMPLE)
                    m = M.read_meta(d)
                    m["status"]["chords"] = "ok"
                    m.pop("error", None)
                    log("OK", d.name, f"chords ({chordify.detected_key(d)})")
                except Exception as e:  # noqa: BLE001
                    m = M.read_meta(d)
                    m["status"]["chords"] = "error"
                    m["error"] = str(e)
                    log("ERR", d.name, f"chords: {e}")
                M.write_meta(d, m)
        finally:
            chordify.close_context(ctx)


def write_report(out: Path) -> None:
    rows = []
    for d in sorted(out.iterdir()) if out.exists() else []:
        if not M.meta_path(d).exists():
            continue
        m = M.read_meta(d)
        rows.append(
            f"| {m['slug']} | {m['title'].replace('|', '/')} | {m['source']} | {m['status']['mp3']} | "
            f"{m['status']['chords']} | {m.get('chordify_url') or ''} | "
            f"{chordify.detected_key(d) if m['status']['chords'] == 'ok' else ''} |"
        )
    header = ("| Slug | Titre | Source | MP3 | Accords | Chordify | Tonalité |\n"
              "|---|---|---|---|---|---|---|\n")
    report = "# Rapport\n\n" + header + "\n".join(rows) + "\n"
    (out / "_report.md").write_text(report, encoding="utf-8")
    print("\n" + report)


def cmd_run(a) -> None:
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    M.migrate_names(out)
    sources: list[tuple[str, str]] = []
    if a.urls:
        p = Path(a.urls)
        if p.exists():
            sources += [("youtube", u) for u in read_urls(p)]
        else:
            print(f"WARN {p} introuvable, ignoré")
    if a.mp3_dir:
        sources += [("local", str(f)) for f in sorted(Path(a.mp3_dir).glob("*.mp3"))]
    if not sources:
        # ni --urls ni --mp3-dir : on reprend tous les dossiers déjà présents dans songs/ (étape accords seule)
        dirs = [d for d in sorted(out.iterdir()) if d.is_dir() and M.meta_path(d).exists()]
        if not dirs:
            sys.exit(f"Rien à traiter : {out} est vide. Fournir --urls et/ou --mp3-dir")
        print(f"Reprise sur {len(dirs)} chanson(s) de {out}/ (accords uniquement)")
        step_chords(dirs, a.force, a.headless)
        write_report(out)
        return

    if a.only == "chords":
        dirs = []
        for kind, src in sources:
            d = M.find_existing(out, youtube_url=src if kind == "youtube" else None,
                                local_file=str(Path(src).resolve()) if kind == "local" else None)
            if d:
                dirs.append(d)
            else:
                log("SKIP", src, "pas encore importé (lancer sans --only chords)")
    elif a.only == "mp3":
        dirs = step_mp3(sources, out, a.force)
    else:
        dirs = step_mp3(sources, out, a.force)
    if a.only != "mp3":
        step_chords(dirs, a.force, a.headless)
    write_report(out)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="ouvre Chordify pour te connecter (session conservée)")
    r = sub.add_parser("run", help="télécharge/importe l'audio puis récupère les accords")
    r.add_argument("--urls", help="fichier de liens YouTube (un par ligne)")
    r.add_argument("--mp3-dir", help="dossier de MP3 locaux")
    r.add_argument("--out", default="songs")
    r.add_argument("--only", choices=["mp3", "chords"])
    r.add_argument("--force", action="store_true")
    r.add_argument("--headless", action="store_true")
    a = ap.parse_args()
    if a.cmd == "login":
        chordify.login(PROFILE_DIR)
    else:
        cmd_run(a)


if __name__ == "__main__":
    main()
