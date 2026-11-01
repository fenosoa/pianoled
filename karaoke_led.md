sur le projet de pilotage de led (racine), rajoute un mode « karaoké » piloté par un lecteur d'accords web qui tourne sur un
PC Windows du réseau local. Ce lecteur c'est "web_chords_karaoke" exposé sur un serveur WebSocket. Le Pi doit s'y
connecter en tant que CLIENT et écouter les messages. .

Le Pi a exactement deux états :

## Mode PAUSE (état par défaut)
- C'est le comportement actuel : les touches appuyées s'allument (MIDI → LEDs).
- Le Pi démarre dans ce mode.

## Mode KARAOKÉ
- Les LEDs sont dictées UNIQUEMENT par l'accord en cours reçu via WebSocket.
- Le MIDI du clavier est IGNORÉ pour l'éclairage (on continue à le lire, mais il
  n'affecte pas les LEDs).
- Pour un accord donné, allume TOUTES les touches du clavier dont la note
  (pitch class) appartient à l'accord, sur toutes les octaves.
  Exemple : Em → toutes les touches Mi, Sol et Si.
- Les accords reçus sont déjà dans la tonalité affichée au musicien (Sol majeur /
  Mi mineur). Le Pi n'applique AUCUN transpose.
- Au changement d'accord, fais une transition courte (fondu d'environ 100 à 150 ms,
  paramétrable) pour que ce soit agréable à l'œil.
- Une couleur par accord (ou par fonction harmonique), définie dans la config.
- Accord inconnu, vide ou « N.C. » : éteindre les LEDs (ou garder le dernier accord,
  paramétrable), sans planter.
- Accord avec une basse est traité comme accord principal le premier accord. Exemple : D/F# => D (la basse F# est colorée uniquement sur la moitié gauche des leds avec une couleur rouge et le reste des touches sont colorées pour l'accord D)

## Transitions
- Message `song` ou `chord` reçu → passage en KARAOKÉ.
- Message `idle` reçu → passage en PAUSE.
- Aucun message `chord` depuis N secondes (défaut : 30 s, paramétrable) → PAUSE.
- WebSocket déconnecté → PAUSE immédiate.
- Logge chaque changement de mode avec sa cause.

# Étape 1 — Client WebSocket

- URL du serveur dans un fichier de config (ex. `ws://192.168.x.x:PORT`).
- Reconnexion automatique avec backoff (1 s, 2 s, 5 s, puis toutes les 5 s), à
  l'infini. Le Pi doit pouvoir démarrer AVANT le lecteur et s'y connecter dès qu'il
  apparaît.
- Le client ne doit JAMAIS bloquer ni faire planter la boucle LED/MIDI (thread
  séparé ou asyncio selon l'architecture existante).
- Un message JSON invalide est ignoré et loggé.

## Protocole (messages JSON)

{"type": "song"}
{"type": "chord", "chord": "Em"}
{"type": "idle"}

Ignore silencieusement tout autre type de message : le serveur sert aussi à
synchroniser des tablettes et diffuse d'autres messages.

# Étape 2 — Parsing des accords

Écris un module dédié et testé qui convertit un nom d'accord en ensemble de pitch
classes (0–11). Il doit accepter :
- les fondamentales avec dièses et bémols : C, C#, Db, D… B ;
- les deux notations : « Em », « G7 », « Cmaj7 », mais aussi le format Chordify
  « E:min », « G:maj », « A:7 », « D:min7 » ;
- les qualités : majeur, mineur, 7, maj7, m7, dim, aug, sus2, sus4, 6, m6, 9
  (pour 9 et au-delà, simplifier en accord de 7e) ;
- les accords avec basse « G/B » : ajouter la basse à l'ensemble des notes.
Ajoute des tests unitaires pour ce module.

# Étape 3 — Livrables

1. Le code modifié, en touchant le moins possible à l'existant.
2. Un fichier de config avec : URL WebSocket, timeout de pause, durée de fondu,
   couleurs des accords, luminosité de chaque mode.
3. Un petit script de test `fake_player` qui lance un serveur WebSocket local et
   envoie une séquence : song → Em → C → G → D → idle, à quelques secondes
   d'intervalle, pour valider sans le vrai lecteur.
4. Un README court : lancement, config, test.

Contrainte importante : c'est pour une soirée ce soir. Privilégie la robustesse et
la simplicité à l'élégance. En cas de doute sur l'existant, demande-moi avant de
modifier.