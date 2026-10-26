# Contexte
Je monte un karaoké familial à la maison. Les chansons sont en MALGACHE (Whisper inutilisable),
mais j'ai les paroles exactes et des stems de très bonne qualité (voix isolée disponible).
Je joue le piano en live ; le public chante en suivant les paroles sur une tablette.
J'ai déjà un lecteur d'accords web (Vite) qui lit un MP3/MP4 avec une timeline JSON des accords.
Tout le développement et l'exécution se font sous WINDOWS 10/11.

# Objectif
Un projet « Karaoke Studio » en deux parties :
1. Moteur d'analyse Python : MP3 + paroles (+ stem voix) → JSON de timeline mot par mot.
2. Front web en Node/Vite : upload, éditeur de correction, et lecteur karaoké final festif.
Le lecteur doit être un module réutilisable, que j'intégrerai ensuite dans mon lecteur d'accords.

# Architecture
karaoke-studio/
  engine/   → Python 3.11 + FastAPI (API d'alignement, stockage des chansons)
  web/      → Vite + TypeScript, vanilla (pas de framework lourd)
  songs/    → un dossier par chanson : audio, vocals, paroles.txt, lyrics.json
- Le front Vite appelle l'API via un proxy Vite (/api → http://localhost:8000).
- Un `start.ps1` lance les deux (crée le venv au premier lancement, npm install si besoin),
  plus un `start.bat` pour le double-clic. Les deux serveurs écoutent sur 0.0.0.0, pour que
  je puisse ouvrir le lecteur depuis une tablette sur le réseau local.

# Partie 1 — Moteur Python (engine/)
- Alignement forcé avec ctc-forced-aligner (https://github.com/MahmoudAshraf97/ctc-forced-aligner),
  modèle MMS de Meta, langue `mlg`, avec romanisation. Lis d'abord son README ; préfère son API
  Python à la CLI.
- GPU NVIDIA (CUDA) auto-détecté s'il est présent, sinon CPU. Le README donne la commande pip
  de torch/torchaudio pour chaque cas.
- ffmpeg requis (`winget install Gyan.FFmpeg`) : vérifie au démarrage qu'il est dans le PATH,
  avec un message clair sinon. Convertis les entrées en WAV mono 16 kHz pour l'alignement.
- Pièges Windows : chemins avec espaces et accents, UTF-8 explicite partout, pathlib.

Entrées (POST /api/songs, multipart) :
- `audio` : le MP3 ou MP4 de lecture (obligatoire). C'est lui que le lecteur jouera.
- `vocals` : le stem voix principale isolée (fortement recommandé). L'alignement se fait sur lui.
  Il doit avoir le même début et la même durée que `audio` : vérifie que les durées
  correspondent (tolérance de 100 ms) et alerte sinon. Sans stem voix, aligne sur `audio`
  avec un avertissement affiché dans l'UI.
- `lyrics` : fichier .txt ou texte collé.

Format du texte de paroles :
- Exhaustif : tout ce qui est chanté, dans l'ordre, refrains répétés compris.
- Une ligne de texte = une ligne affichée. Ligne vide = changement d'écran.
- Balises de section facultatives sur une ligne seule : [couplet], [refrain], [pont], [intro], [outro].
- Sans balise : détection automatique. Les lignes (ou groupes de lignes) qui reviennent
  plusieurs fois = refrain, le reste = couplet. La comparaison ignore casse, ponctuation et accents.
- Le texte affiché garde accents, ponctuation et casse d'origine. L'alignement se fait sur la
  version normalisée/romanisée, en conservant la correspondance mot affiché ↔ mot aligné.

Traitement asynchrone : POST renvoie un id de job, GET /api/jobs/{id} donne la progression.
Cache du résultat par hash des fichiers.

Autres endpoints :
- GET /api/songs, GET /api/songs/{id}, GET /api/songs/{id}/audio (avec Range pour le seek)
- PUT /api/songs/{id}/lyrics (sauvegarde du JSON corrigé)
- GET /api/songs/{id}/export?format=json|lrc|lrc-words

# Format JSON de sortie (lyrics.json) — même base de temps que mon JSON d'accords
Temps en secondes depuis le début du fichier audio, en float à 2 décimales.
{
  "version": 1,
  "offset": 0.0,
  "sections": [
    { "type": "refrain",
      "lines": [
        { "start": 12.34, "end": 15.80,
          "words": [ { "t": "Tiako", "start": 12.34, "end": 12.90, "c": 0.92 } ] }
      ] }
  ]
}
- `type` ∈ couplet | refrain | pont | intro | outro.
- `c` = score de confiance de l'aligneur (facultatif, utilisé par l'éditeur).
- `offset` = décalage global appliqué à l'affichage.
- Pas de transpose ni d'accords dans ce fichier : ils restent dans d'autres fichiers.

# Partie 2 — Front Vite (web/)
## Écran 1 : Upload
Glisser-déposer de l'audio, du stem voix et du .txt (ou zone de texte), titre et artiste,
barre de progression de l'alignement, liste des chansons déjà traitées.

## Écran 2 : Éditeur de correction
- Forme d'onde (wavesurfer.js) avec bascule mix / voix seule et vitesse 0.5x–1x.
- Mots positionnés sous la forme d'onde, bords glissables. Mots à faible confiance surlignés.
- Raccourcis : Espace = play/pause ; Tab / Shift+Tab = mot suivant/précédent ;
  ← / → = début du mot ±50 ms (Shift = ±10 ms) ; Alt+← / Alt+→ = fin du mot ;
  Ctrl+← / Ctrl+→ = décaler toute la ligne ; T = mode tap (pendant la lecture, chaque appui
  fixe le début du mot suivant) ; R = rejouer la ligne ; Ctrl+Z / Ctrl+Shift+Z.
- Réglage de l'offset global. Changement du type de section d'une ligne via un menu.
- Sauvegarde automatique (PUT) et aperçu du lecteur final dans un panneau.

## Écran 3 : Lecteur karaoké final (plein écran, pensé pour tablette)
Style festif, inspiré de Karafun :
- Deux lignes visibles : la ligne courante en grand, la suivante plus petite en dessous.
  Texte très gros, lisible à 3 m, avec un contour ou une ombre pour rester lisible sur tout fond.
- Remplissage progressif mot par mot synchronisé sur l'audio (dégradé CSS ou clip animé
  à chaque frame via requestAnimationFrame, fluide à 60 fps).
- Fond en dégradé animé qui change doucement de couleur. Une palette par type de section :
  le refrain a sa propre couleur de remplissage et une légère pulsation lumineuse.
- Compte à rebours en points (3, 2, 1) avant chaque reprise du chant après un silence > 4 s ;
  pendant les passages instrumentaux, titre ou animation d'attente.
- Transitions douces entre les lignes (glissement vers le haut).
- Contrôles discrets qui disparaissent après 3 s d'inactivité.

## Contrainte d'architecture importante pour le lecteur
Isole le rendu dans un module `KaraokeRenderer` indépendant de la source audio :
- `load(lyricsJson)`, `render(currentTimeSeconds)`, `setTheme(...)`, `mount(element)`.
- Il ne lit jamais l'audio lui-même. Une horloge externe lui fournit le temps.
- Fournis une source d'horloge `AudioElementClock` (basée sur un élément <audio>/<video>)
  derrière une interface `Clock` (`now()`, `onPlay`, `onPause`, `onSeek`).
Plus tard, je remplacerai cette horloge par une horloge pilotée par WebSocket
(une tablette maître joue l'audio et diffuse play/pause/seek + position chaque seconde,
les autres tablettes suivent), et j'intégrerai le renderer dans mon lecteur d'accords existant.
Ne code pas le WebSocket maintenant, mais rends ce remplacement trivial.

# Exports
- lyrics.json (format ci-dessus)
- LRC par ligne, et LRC enrichi mot par mot (<mm:ss.xx>)

# Livrables
- Projet complet, requirements Python épinglés, package.json, README d'installation Windows.
- Un test de bout en bout sur un extrait court.
- Code commenté, 100 % local, sans dépendance cloud.

# Méthode
Procède par étapes et montre-moi le résultat avant de passer à la suivante :
1. Installer ctc-forced-aligner et valider l'alignement en ligne de commande sur 30 s
   d'un stem voix malgache, avec le JSON produit.
2. API FastAPI + génération du lyrics.json complet (détection des sections incluse).
3. Lecteur karaoké final (KaraokeRenderer + AudioElementClock), testé sur ce JSON.
4. Éditeur de correction.
5. Écran d'upload et exports.