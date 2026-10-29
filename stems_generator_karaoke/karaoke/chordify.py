"""Étape 2 : accords via Chordify (Playwright, contexte persistant).

Tous les sélecteurs fragiles sont regroupés ici, en tête de fichier.
"""
import json
import re
import time
import unicodedata
from pathlib import Path

from . import meta as M

HOME_URL = "https://chordify.net/"
LOGIN_URL = "https://chordify.net/login"

# --- Sélecteurs / heuristiques FRAGILES (à ajuster si Chordify change son interface) ---
SEL_URL_INPUT = 'input[type="text"], input[type="url"], input[type="search"]'  # champ « coller un lien »
SEL_FILE_INPUT = 'input[type="file"]'                                         # upload MP3 (n'existe qu'après clic sur le bouton)
SEL_UPLOAD_BUTTON = 'button:has-text("Upload song"), a:has-text("Upload song"), [role="button"]:has-text("Upload song"), button:has-text("Upload"), button:has-text("Importer")'

SEL_LOGIN_LINK = 'a[href*="/login"], a[href*="/signin"], button:has-text("Log in"), button:has-text("Se connecter")'
SEL_COOKIE_ACCEPT = 'button:has-text("Accept"), button:has-text("Accepter"), button:has-text("Agree")'
SONG_URL_MARKER = "/chords/"          # l'URL finale d'une chanson contient /chords/
RESULT_WAIT_S = 4  # attente avant de cliquer sur le résultat de recherche
SEL_RESULT_CANDIDATES = [  # premier résultat cliquable après soumission du lien
    'a[href*="/chords/"]',
    '[class*="result" i] a',
    '[class*="song" i] a',
]
HYDRATION_JS = "() => window.__staticRouterHydrationData"
# --------------------------------------------------------------------------------------

ANALYSIS_TIMEOUT_S = 6 * 60
MAX_ATTEMPTS = 2


class NotLoggedIn(RuntimeError):
    pass


class StructureMismatch(RuntimeError):
    pass


class TitleMismatch(RuntimeError):
    pass


# --- Vérification du titre : la page Chordify doit correspondre à la chanson demandée ---
TITLE_MIN_RATIO = 0.6
_NOISE = {
    "official", "officiel", "officielle", "video", "videoclip", "music", "clip", "audio", "lyrics", "lyric",
    "hd", "4k", "ft", "feat", "featuring", "full", "song", "version", "remastered", "remasterisee",
    "the", "a", "an", "le", "la", "les", "de", "du", "des", "et", "and", "chords", "chord", "by", "par",
}


def _tokens(text: str) -> set[str]:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return {t for t in re.findall(r"[a-z0-9]+", text) if t not in _NOISE and len(t) > 1}


def title_matches(expected: str, found: str) -> bool:
    """Vrai si la plupart des mots significatifs du titre attendu figurent dans le texte trouvé."""
    exp = _tokens(expected)
    if not exp:
        return True
    return len(exp & _tokens(found)) / len(exp) >= TITLE_MIN_RATIO


def page_title_text(page) -> str:
    parts = []
    try:
        parts.append(page.title())
    except Exception:
        pass
    try:
        parts.append(page.locator("h1").first.inner_text(timeout=1500))
    except Exception:
        pass
    return " ".join(parts)


CDP_PORT = 9222
_CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def _port_open() -> bool:
    import socket

    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", CDP_PORT)) == 0


def ensure_chrome(profile_dir: Path, start_url: str | None = None) -> None:
    """Lance le vrai Chrome (profil dédié, port de debug) s'il n'est pas déjà ouvert."""
    import subprocess

    if _port_open():
        return
    exe = next((p for p in _CHROME_PATHS if Path(p).exists()), None)
    if not exe:
        raise RuntimeError("Chrome/Edge introuvable (ajuste _CHROME_PATHS dans chordify.py)")
    args = [exe, f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={profile_dir}",
            "--no-first-run", "--no-default-browser-check"]
    if start_url:
        args.append(start_url)
    subprocess.Popen(args)
    for _ in range(40):
        if _port_open():
            return
        time.sleep(0.5)
    raise RuntimeError("Chrome n'a pas ouvert le port de debug")


def open_context(playwright, profile_dir: Path, headless: bool = False):
    """Se connecte au vrai Chrome via CDP (pas de navigateur Playwright : moins détectable).
    `headless` est ignoré : Chrome reste visible."""
    ensure_chrome(profile_dir)
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{CDP_PORT}")
    return browser.contexts[0]


def close_context(ctx) -> None:
    """Se déconnecte sans fermer le Chrome de l'utilisateur."""
    try:
        ctx.browser.close()
    except Exception:
        pass


def login(profile_dir: Path) -> None:
    """Ouvre Chrome sur la page de connexion et attend qu'il soit fermé."""
    if _port_open():
        raise RuntimeError("Chrome (profil karaoké) est déjà ouvert : connecte-toi dedans puis ferme-le.")
    ensure_chrome(profile_dir, LOGIN_URL)
    print("Connecte-toi à Chordify, puis ferme complètement Chrome.")
    try:
        while _port_open():
            time.sleep(1)
    except KeyboardInterrupt:
        pass


def _dismiss_cookies(page) -> None:
    try:
        page.locator(SEL_COOKIE_ACCEPT).first.click(timeout=2000)
    except Exception:
        pass


def is_logged_in(page) -> bool:
    """Heuristique : pas de lien/bouton de connexion visible sur la page d'accueil."""
    page.goto(HOME_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    _dismiss_cookies(page)
    return page.locator(SEL_LOGIN_LINK).count() == 0


def _read_hydration(page):
    """Retourne l'entrée loaderData contenant chords.value, ou None."""
    try:
        data = page.evaluate(HYDRATION_JS)
    except Exception:
        return None
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            return None
    loader = (data or {}).get("loaderData") or {}
    for entry in loader.values():
        if not isinstance(entry, dict):
            continue
        chords = entry.get("chords")
        if isinstance(chords, dict) and "value" in chords:
            return entry
    return None


def _click_matching_result(page, title: str) -> bool:
    """Après la soumission, Chordify peut afficher une liste de résultats : clique le premier
    dont le texte correspond au titre attendu (jamais un résultat au hasard)."""
    try:
        links = page.locator('a[href*="/chords/"]')
        for i in range(min(links.count(), 15)):
            link = links.nth(i)
            try:
                text = (link.inner_text(timeout=500) or "") + " " + (link.get_attribute("href") or "")
                if link.is_visible(timeout=500) and title_matches(title, text):
                    print(f"  clic sur le résultat correspondant : {text.strip()[:80]!r}")
                    link.click(timeout=5000)
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def _wait_for_chords(page, timeout_s: int, title: str = "", click_results: bool = True):
    start = time.time()
    deadline = start + timeout_s
    last_reload = time.time()
    last_click = start
    clicks = 0
    while time.time() < deadline:
        if click_results and SONG_URL_MARKER not in page.url and clicks < 3 and time.time() - last_click > 5 \
                and time.time() - start > RESULT_WAIT_S:
            last_click = time.time()
            clicks += _click_matching_result(page, title)
        if SONG_URL_MARKER in page.url:
            entry = _read_hydration(page)
            if entry is not None:
                return entry
            # l'analyse peut ne pas être finie au moment du rendu serveur : recharger périodiquement
            if time.time() - last_reload > 30:
                page.reload(wait_until="domcontentloaded")
                last_reload = time.time()
        page.wait_for_timeout(2000)
    raise TimeoutError(f"Pas de données d'accords après {timeout_s}s (url: {page.url})")


def _submit_youtube(page, url: str) -> None:
    page.goto(HOME_URL, wait_until="domcontentloaded")
    _dismiss_cookies(page)
    field = page.locator(SEL_URL_INPUT).first
    field.wait_for(state="visible", timeout=15000)
    field.fill(url)
    field.press("Enter")


def _submit_upload(page, mp3: Path) -> None:
    page.goto(HOME_URL, wait_until="domcontentloaded")
    _dismiss_cookies(page)
    page.wait_for_timeout(1500)
    # le bouton « Upload song » ouvre le sélecteur de fichier : on l'intercepte
    try:
        with page.expect_file_chooser(timeout=15000) as fc:
            page.locator(SEL_UPLOAD_BUTTON).first.click(timeout=10000)
        fc.value.set_files(str(mp3))
    except Exception:
        # repli : input file déjà présent dans le DOM
        page.locator(SEL_FILE_INPUT).first.set_input_files(str(mp3), timeout=10000)


def compare_structure(actual, expected, path="$") -> list[str]:
    """Compare le squelette (clés + types) de deux JSON ; renvoie les écarts."""
    diffs = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        for k in expected.keys() - actual.keys():
            diffs.append(f"{path}.{k}: manquant")
        for k in actual.keys() - expected.keys():
            diffs.append(f"{path}.{k}: en trop")
        for k in expected.keys() & actual.keys():
            diffs += compare_structure(actual[k], expected[k], f"{path}.{k}")
    elif isinstance(expected, list) and isinstance(actual, list):
        if expected and actual:
            diffs += compare_structure(actual[0], expected[0], f"{path}[0]")
    elif type(actual) is not type(expected) and not (actual is None or expected is None):
        diffs.append(f"{path}: type {type(actual).__name__} au lieu de {type(expected).__name__}")
    return diffs


def check_against_sample(data: dict, sample_path: Path) -> None:
    if not sample_path.exists():
        print(f"  WARN  {sample_path} introuvable : structure non vérifiée")
        return
    sample = json.loads(sample_path.read_text(encoding="utf-8"))
    diffs = compare_structure(data, sample)
    if diffs:
        raise StructureMismatch("Structure différente de l'exemple :\n    " + "\n    ".join(diffs[:20]))


def fetch_chords(song_dir: Path, page, sample_path: Path | None = None) -> dict:
    """Récupère les accords d'une chanson (lien YouTube ou upload selon meta.json) et écrit chords.json.

    Le JSON est enregistré brut (entrée loaderData contenant chords.value), sans transformation.
    """
    song_dir = Path(song_dir)
    meta = M.read_meta(song_dir)

    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            if meta.get("chordify_url"):
                page.goto(meta["chordify_url"], wait_until="domcontentloaded")
            elif meta["source"] == "youtube" and not meta.get("chordify_upload"):
                _submit_youtube(page, meta["youtube_url"])
            else:
                _submit_upload(page, M.audio_path(song_dir))

            upload = bool(meta.get("chordify_upload"))
            entry = _wait_for_chords(page, ANALYSIS_TIMEOUT_S, meta["title"], click_results=not upload)
            if upload:
                pid = str(((entry.get("chords") or {}).get("value") or {}).get("pseudoId", ""))
                if not pid.startswith("file:"):
                    raise TitleMismatch(f"upload : Chordify a renvoyé une version existante ({pid}), pas l'analyse du MP3")
            found = page_title_text(page) + " " + page.url
            # upload forcé : le fichier vient de nous, le titre Chordify n'a pas de sens à comparer
            if not meta.get("chordify_upload") and not title_matches(meta["title"], found):
                meta.pop("chordify_url", None)  # ne jamais mémoriser une page qui n'est pas la bonne chanson
                M.write_meta(song_dir, meta)
                raise TitleMismatch(f"titre Chordify différent : attendu {meta['title']!r}, trouvé {found.strip()[:120]!r}")
            meta["chordify_url"] = page.url
            M.write_meta(song_dir, meta)  # on garde l'URL pour ne jamais ré-uploader

            if sample_path:
                check_against_sample(entry, sample_path)
            (song_dir / "chords.json").write_text(
                json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return entry
        except (StructureMismatch, TitleMismatch):
            raise
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"  tentative {attempt}/{MAX_ATTEMPTS} échouée : {e}")
    raise RuntimeError(f"Chordify a échoué : {last_err}")


def detected_key(song_dir: Path) -> str:
    try:
        d = json.loads((Path(song_dir) / "chords.json").read_text(encoding="utf-8"))
        return str(d["chords"]["value"].get("derivedKey") or "?")
    except Exception:
        return "?"
