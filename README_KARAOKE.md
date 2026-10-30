# Karaoké : jouer live

Le projet a deux axes :

1. **Axe 1 : jouer live en karaoké** (ce document). Une chanson (stems + accords + paroles) est lue sur un écran « maître » ; des écrans suiveurs affichent en direct les accords piano, les accords guitare et les paroles.
2. **Axe 2 : apprentissage au clavier**. Moteur MIDI → LED et routage RTP-MIDI pour Synthesia, décrit dans le [README principal](README.md).

## Démarrage rapide (Windows)

Double-clic sur [start-karaoke.bat](start-karaoke.bat), ou :

```powershell
.\start-karaoke.ps1              # tout lancer
.\start-karaoke.ps1 -NoEngine    # sans le moteur Python d'alignement
```

Le script démarre chaque serveur dans une fenêtre réduite. **Un serveur dont le port est déjà en écoute est ignoré** : on peut donc le relancer sans risque. Il fait `npm install` au premier lancement d'un projet. Pour arrêter un serveur, fermer sa fenêtre.

| Projet | Port | Rôle |
| --- | --- | --- |
| [web_chords_karaoke](web_chords_karaoke) | 5180 | Lecteur d'accords piano = **maître**. Joue les stems, héberge le hub WebSocket `/sync`, la playlist et les commandes Stream Deck |
| [web_guitar_karaoke](web_guitar_karaoke) | 5190 | Accords **guitare**, lecture seule, avec capo calculé dans le navigateur |
| [web_lyrics_karaoke/web](web_lyrics_karaoke/web) | 5173 | Paroles karaoké. Page `#/sync` pour suivre le maître ; éditeur de synchro |
| [web_lyrics_karaoke/engine](web_lyrics_karaoke/engine) | 8000 | Moteur Python (FastAPI) d'alignement des paroles. Optionnel pour la lecture |

Pages utiles : lecteur `http://localhost:5180`, playlist `http://localhost:5180/playlist.html`, guitare `http://localhost:5190`, paroles `http://localhost:5173/#/sync`.

Depuis une tablette ou un téléphone du réseau local, remplacer `localhost` par l'IP du PC. Les clients suiveurs cherchent le maître sur le même hôte au port 5180. Pour un autre hôte : `?sync=ip:5180` (mémorisé dans le navigateur).

## Architecture

```text
 stems + <nom>.chords.json + <nom>.lyrics.json
   (web_chords_karaoke/piano_stems_output/<chanson>/)
                    │
                    ▼
        web_chords_karaoke :5180  ◄── Stream Deck (/control/...), playlist.html
        (lit l'audio, MAÎTRE)
                    │  WebSocket /sync : { song }, { state: playing, time, rate }
        ┌───────────┴────────────┐
        ▼                        ▼
 web_guitar_karaoke :5190   web_lyrics_karaoke :5173 (#/sync)
 (suiveur, lecture seule)   (suiveur)
```

- Le maître envoie la chanson (id, titre, paroles) à chaque changement, et l'état de lecture à chaque événement et chaque seconde. Les suiveurs interpolent le temps entre deux messages.
- Les suiveurs sont en **lecture seule** : aucune commande ne remonte vers le maître.
- Les chansons sont les sous-répertoires de `web_chords_karaoke/piano_stems_output` (ou de la variable d'environnement `STEMS_DIR`). Chacun contient les stems `.flac`, `<nom>.chords.json` et, en option, `<nom>.lyrics.json`.

## Client guitare

Tout le calcul se fait dans le navigateur ([guitar-transpose.js](web_guitar_karaoke/src/guitar-transpose.js)). Le client lit la timeline d'accords du serveur et la recalcule en direct.

- Les accords du fichier sont dans la tonalité « piano » (G ou Em). La tonalité réelle est `originalKey`. Comme l'audio ne change pas, on ne transpose pas le son : on choisit les **formes** les plus faciles avec ou sans capo (forme jouée = accord du fichier + décalage vers `originalKey` − capo).
- **Recommandation automatique** : capo 0 d'abord, puis capo 1, 2… jusqu'à 7. Chaque accord reçoit une difficulté (corde à vide, barré, accord pénible comme D#m), pondérée par sa durée dans le morceau. Chaque case de capo ajoute un coût, qui augmente plus vite après la case 5. Les constantes sont en tête du module.
- **− / +** changent le capo en direct (0 à 11) et recalculent les accords. **↺ Auto** revient à la recommandation.
- Les accords sont colorés par difficulté (vert / orange / rouge). Le bloc « Comparer les capos » liste les accords difficiles de chaque option.
- Tests : `cd web_guitar_karaoke && npm test`.

## Moteur de paroles

Voir [web_lyrics_karaoke/web_lyrics_karaoke.md](web_lyrics_karaoke/web_lyrics_karaoke.md). Première installation du moteur : `web_lyrics_karaoke\engine\setup.ps1` (crée le venv). Le script de démarrage ignore le moteur tant que ce venv est absent.

## Dépannage

- **« Lecteur d'accords injoignable… »** sur un suiveur : le serveur du port 5180 n'est pas démarré, ou le suiveur pointe vers le mauvais hôte (`?sync=ip:5180`).
- **« Accords introuvables pour cette chanson »** (guitare) : le serveur 5180 doit avoir été redémarré depuis l'ajout de l'en-tête CORS sur `/stems/`.
- **Un port est déjà pris par autre chose** : le script le considère comme « déjà démarré ». Libérer le port, ou fermer le programme qui l'occupe.
