# Pipeline karaoké — Étape 1 : MP3 + accords Chordify

## Contexte

Je prépare un karaoké « live » pour un anniversaire (dimanche). Pour chaque chanson, j'ai besoin d'un dossier contenant l'audio et le JSON d'accords Chordify, que mon lecteur web sait déjà lire tel quel.

Ce script est la **première brique** d'un pipeline Python plus large (stems, paroles et alignement viendront ensuite, dans des scripts séparés). Il doit donc être modulaire : une fonction par étape, réutilisable plus tard par un `pipeline.py` global.

Environnement : Windows, Python 3.11+, ffmpeg déjà installé et dans le PATH. Compte **Chordify Premium** (upload de MP3 autorisé).

## Objectif

Deux modes d'entrée, une même sortie :

```
Mode A : urls.txt (liens YouTube) → audio.mp3 + meta.json → Chordify (via le lien YouTube) → chords.json
Mode B : dossier de MP3 locaux     → audio.mp3 + meta.json → Chordify (via upload du MP3)  → chords.json
```

Si `urls.txt` n'existe pas ou n'est pas fourni, le script doit pouvoir travailler uniquement avec un dossier de MP3. Les deux modes peuvent aussi être combinés dans un même lancement.

## Structure de sortie

```
songs/
  <slug>/
    audio.mp3
    meta.json
    chords.json
```

`meta.json` contient au minimum :

```json
{
  "slug": "...",
  "title": "...",
  "source": "youtube | local",
  "youtube_url": "... ou null",
  "local_file": "chemin d'origine ou null",
  "duration": 0,
  "chordify_url": "renseigné après traitement Chordify",
  "status": { "mp3": "ok|error", "chords": "ok|error|pending" },
  "updated_at": "ISO 8601"
}
```

Le `slug` est dérivé du titre YouTube (mode A) ou du nom du fichier (mode B) : caractères sûrs pour Windows, 80 caractères maximum, unique (suffixe `_2`, `_3` en cas de collision).

## Étape 1 — Récupération audio

**Mode A (YouTube)** : utiliser `yt-dlp` en bibliothèque Python. Meilleur audio disponible, conversion en MP3 320 kbps via ffmpeg, enregistré sous `songs/<slug>/audio.mp3`. Les lignes vides et celles qui commencent par `#` dans `urls.txt` sont ignorées.

**Mode B (local)** : copier chaque MP3 du dossier fourni vers `songs/<slug>/audio.mp3` (copie, pas déplacement). Lire la durée et, si présents, les tags ID3 (titre, artiste) pour enrichir `meta.json`.

## Étape 2 — Chordify

Automatisation navigateur avec **Playwright pour Python** (Chromium).

- **Mode A** : soumettre le lien YouTube à Chordify (champ de recherche / « coller un lien »), attendre la page de la chanson.
- **Mode B** : utiliser la fonction d'upload de Chordify (`set_input_files` sur l'input fichier), attendre la fin du traitement et la page de la chanson.

Dans les deux cas, enregistrer l'URL finale de la page Chordify dans `meta.json` (`chordify_url`), pour ne jamais ré-uploader un fichier déjà traité.

### Récupération du JSON

Les données d'accords sont exposées dans la page via `window.__staticRouterHydrationData` (dans `loaderData`, chercher l'entrée qui contient `chords.value` ; ce dernier contient notamment `chords` au format `temps;accord;début;fin` ligne par ligne, `derivedKey`, `derivedBpm`, `barLength`).

**Important :** enregistrer le JSON **brut, sans transformation**, dans `chords.json`, car mon lecteur le lit déjà directement. Je fournis un `chords.json` d'une chanson qui marche déjà dans `samples/chords_example.json` : vérifier que la structure produite est strictement identique avant de valider. Si la structure de la page Chordify a changé, inspecter la page et me signaler l'écart plutôt que d'improviser un format.

### Authentification

Pas de mot de passe dans le code ni dans les arguments.

- Utiliser un **contexte Playwright persistant** (`launch_persistent_context` avec un dossier `.chordify_profile/`) : au premier lancement, le navigateur s'ouvre et je me connecte moi-même à Chordify ; les lancements suivants réutilisent la session.
- Prévoir une commande `login` qui ouvre simplement le navigateur sur la page de connexion et attend que je ferme la fenêtre.
- Si le script détecte qu'il n'est pas connecté (mode B notamment), il s'arrête avec un message clair invitant à lancer `login`.
- Ajouter `.chordify_profile/` au `.gitignore`.

### Robustesse

- Navigateur **visible par défaut** (`--headless` en option), car Chordify peut bloquer les navigateurs headless.
- Petit délai aléatoire entre deux chansons, pas de traitement en parallèle côté Chordify.
- Timeouts généreux pour l'analyse d'un upload (plusieurs minutes), avec 2 tentatives maximum.
- Une erreur sur une chanson ne bloque jamais les autres : elle est notée dans `meta.json` et dans le rapport final.

## Comportement général

- **Idempotent** : une étape déjà faite (fichier présent et statut `ok`) est sautée. `--force` pour tout refaire, `--only mp3|chords` pour lancer une seule étape.
- **Rapport final** dans la console et dans `songs/_report.md` : une ligne par chanson avec titre, source, statut de chaque étape, lien Chordify, tonalité détectée. Ce rapport me sert à vérifier rapidement que Chordify a pris la bonne chanson.
- Logs lisibles (`OK`, `SKIP`, `ERR`) avec le slug.

## Interface en ligne de commande

```
python step1_chords.py login
python step1_chords.py run --urls urls.txt
python step1_chords.py run --mp3-dir "D:\Karaoke\mp3"
python step1_chords.py run --urls urls.txt --mp3-dir "D:\Karaoke\mp3"
python step1_chords.py run --urls urls.txt --only mp3
python step1_chords.py run --mp3-dir ... --force --headless
```

Option `--out` pour changer le dossier de sortie (défaut : `songs`).

## Organisation du code

- `step1_chords.py` : CLI.
- `karaoke/download.py` : `download_youtube(url, out_dir) -> Path` et `import_local(mp3_path, out_dir) -> Path`.
- `karaoke/chordify.py` : `fetch_chords(song_dir, page) -> dict`, avec gestion lien YouTube ou upload selon `meta.json`.
- `karaoke/meta.py` : lecture/écriture de `meta.json`, génération de slugs.
- `requirements.txt` : `yt-dlp`, `playwright`, `mutagen`.
- `README.md` court : installation (`pip install -r requirements.txt`, `playwright install chromium`), premier `login`, exemples.

## Hors périmètre pour cette étape

Séparation des stems, transposition, paroles et alignement : ne pas les implémenter, mais garder les fonctions découplées pour pouvoir les brancher ensuite dans un `pipeline.py`.

## Démarche attendue

1. Commencer par le mode A sur une seule URL, vérifier `chords.json` contre `samples/chords_example.json`.
2. Puis le mode B sur un seul MP3 (upload).
3. Puis le traitement en lot et le rapport.
4. Me montrer les sélecteurs Chordify utilisés et signaler tout ce qui paraît fragile.
