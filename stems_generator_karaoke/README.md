# Karaoké — étape 1 : MP3 + accords Chordify

## Installation

```
pip install -r requirements.txt
playwright install chromium
```
ffmpeg doit être dans le PATH.

## Premier lancement

```
python step1_chords.py login
```
Connecte-toi à Chordify (Premium) dans la fenêtre, puis ferme-la. La session est conservée dans `.chordify_profile/`.

## Exemples

```
python step1_chords.py run --urls urls.txt
python step1_chords.py run --mp3-dir "D:\Karaoke\mp3"
python step1_chords.py run --urls urls.txt --mp3-dir "D:\Karaoke\mp3"
python step1_chords.py run --urls urls.txt --only mp3
python step1_chords.py run --mp3-dir ... --force --headless
```

`urls.txt` : un lien YouTube par ligne (`#` = commentaire). Sortie : `songs/<slug>/{audio.mp3,meta.json,chords.json}` et `songs/_report.md`.

Si `samples/chords_example.json` existe, la structure de chaque `chords.json` produit est comparée à cet exemple ; en cas d'écart, la chanson est en erreur (rien n'est reformaté).

Les sélecteurs Chordify sont regroupés en tête de `karaoke/chordify.py`.
