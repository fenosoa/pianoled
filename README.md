# ownpianoled : moteur MIDI → LED (DDP/WLED) et routage RTP-MIDI pour Synthesia

Remplace le boîtier PianoLED Plus en conservant le ruban existant, piloté par un **GLEDOPTO ESP32 / WLED 0.15.1** via **DDP (UDP 4048)**.
Phase actuelle : **80 LED strictement (indices 0..79)**, constante non modifiable (`src/constants.js`).

- **Étape 2** (Windows, sans matériel MIDI) : moteur MIDI → état des notes → trame 80 px → DDP, avec simulateur.
- **Étape 3** (Raspberry Pi 5) : clavier réel + RTP-MIDI bidirectionnel avec Windows/Synthesia, **même moteur**.

## Choix techniques

- **CommonJS** : cohérent avec `test-ddp.js` déjà validé (laissé intact, `npm run ddp:legacy`).
- **Node.js ≥ 20** (testé sous Node 22.11 / Windows 11). Tests via `node:test`, aucune dépendance de test.
- DDP par `node:dgram` uniquement. Pas de requête HTTP vers WLED, pas d'AudioReactive.
- **Une seule dépendance**, optionnelle : `@julusian/midi` (fork maintenu de node-midi / RtMidi, binaires précompilés ; ALSA séquenceur sous Linux, WinMM sous Windows). Elle n'est chargée qu'à l'étape 3 ; l'étape 2 fonctionne sans elle.
- Configuration : variables d'environnement, ou fichier `.env` (copié depuis [.env.example](.env.example), parseur interne, pas de dotenv).

## Arborescence

```text
src/
  constants.js            LED_COUNT=80, 240 octets RGB
  config/                 chargement/validation de la configuration (.env + env)
  midi/messages.js        normalisation MIDI (NoteOn vel 0 -> noteoff, CC, canaux 0..15)
  midi/smf.js             lecture/écriture de fichiers .mid (SMF)
  state/note-state.js     état par source / canal ; pédale ; All Notes Off
  mapping/note-map.js     note -> LED (linéaire ou table JSON), indices validés [0,79]
  render/renderer.js      priorités de couleur -> trame 240 octets
  ddp/packet.js           en-tête DDP (identique à test-ddp.js)
  ddp/transport.js        UDP unicast (ou dry-run / mémoire)
  ddp/frame-scheduler.js  envoi sur changement + keepalive 40 Hz + métriques
  engine.js               assemblage, utilisé par le simulateur ET le service Pi
  adapters/               backend RtMidi, ports auto-reconnectés, routeur 2 chemins
  simulation/scenarios.js scénarios auto-vérifiés
  cli/                    simulate, play-midi, run, ports, capture, kbd-test, rtt-probe
tools/windows/rtp-echo.js écho côté Windows pour mesurer le RTT RTP-MIDI
tools/make-sample-midi.js génère samples/demo-two-hands.mid
deploy/pianoled.service   unité systemd
config/note-map.example.json  exemple de table (non calibrée)
docs/                     installation Windows / Raspberry Pi / WLED, journal de validation
test/                     tests unitaires
```

## Démarrage rapide — Étape 2 (Windows)

```powershell
cd C:\Dev\PianoLed\ownpianoled
copy .env.example .env          # optionnel : défauts = 192.168.1.41:4048, 40 Hz, 80 LED
npm test                        # tests unitaires
npm run demo:all:dry            # tous les scénarios sans réseau (DRY_RUN)
npm run demo:overlap            # chevauchement vert/bleu -> blanc -> vert/bleu -> off sur le ruban
npm run demo:all                # single, chord, overlap, edge, panic, fast sur le ruban
npm run sim                     # mode interactif (k 60, ku 60, s 60 2, su 60 2, panic, stats, q)
```

Scénarios : `single`, `chord`, `overlap`, `scale`, `fast`, `edge`, `panic`, `sweep` (aide à la calibration), `all`.
Options : `--dry-run`, `--host 192.168.1.41`, `--fps 40`, `--hold 400` (ms), `--log debug`.
Chaque scénario vérifie lui-même les couleurs attendues (`PASS/FAIL`) ; code de sortie ≠ 0 en cas d'échec.
La ligne affichée représente les 80 LED : `.` éteinte, `W` clavier, `G`/`B` Synthesia.

> **Valider visuellement les 80 LED** (`npm run demo:all`) avant de passer à l'étape 3.

## Lecture d'un fichier .mid (sans RTP-MIDI)

Le fichier est lu par un parseur SMF interne ([src/midi/smf.js](src/midi/smf.js), formats 0/1/2, running status, changements de tempo, division SMPTE) et rejoué en temps réel dans le **même moteur** que le simulateur et le service.

```powershell
npm run midi:sample                                   # génère samples/demo-two-hands.mid (ch1 mélodie, ch2 accords)
npm run play -- samples/demo-two-hands.mid --info     # analyse : pistes, canaux, tessiture, couleur prévue
npm run play:demo                                     # toutes les notes = source Synthesia (vert/bleu par canal)
npm run play -- mon-morceau.mid --keyboard-channels 1 # canal 1 joué comme le clavier (blanc), le reste comme Synthesia
npm run play -- mon-morceau.mid --keyboard-tracks 2 --speed 0.5 --transpose -12 --leds
```

Options : `--source synthesia|keyboard`, `--keyboard-channels 1,2`, `--keyboard-tracks 2` (numéros affichés par `--info`), `--speed`, `--transpose`, `--start`/`--seconds`, `--include-drums` (canal 10 ignoré par défaut), `--leds` (ligne des LED toutes les 100 ms), plus `--dry-run`, `--host`, `--fps`.
Les couleurs suivent les règles convenues : clavier blanc prioritaire, Synthesia selon `SYNTH_CHANNEL_COLORS` (défaut vert), notes hors mapping non éclairées.
À la fin, l'outil affiche le retard de déclenchement des événements par rapport au fichier (côté Node) et les métriques DDP habituelles.

## Démarrage — Étape 3 (Raspberry Pi 5)

Voir [docs/SETUP-RPI.md](docs/SETUP-RPI.md) et [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md). Résumé :

```bash
npm install                     # installe @julusian/midi
npm run ports                   # noms de ports réellement observés (+ aconnect -l / amidi -l)
# renseigner KEYBOARD_IN_PORT / SYNTHESIA_IN_PORT / SYNTHESIA_OUT_PORT dans .env
npm run capture -- --seconds 60 # relevé réel des messages Synthesia -> règle vert/bleu
npm run kbd-test                # chemin clavier -> Synthesia (notes injectées) + LED blanches
npm run kbd-test -- --mode live --seconds 30
npm run diag                    # service + journal de chaque message + état des LED toutes les 5 s
npm start                       # service normal
```

## Règles de fonctionnement

| Sujet | Politique |
|---|---|
| Canaux | `0..15` dans le code ; `1..16` dans `.env` (`SYNTH_CHANNEL_COLORS`) et les journaux (`ch1`). |
| Sources | `keyboard` et `synthesia` stockées séparément, par canal. Jamais fusionnées. |
| Priorité | clavier → blanc ; sinon Synthesia → couleur du canal ; sinon éteint. Plusieurs canaux Synthesia sur la même note : le plus petit numéro de canal l'emporte. |
| Couleur Synthesia | `SYNTH_DEFAULT_COLOR` (défaut **green** pour tous les canaux) + `SYNTH_CHANNEL_COLORS=1:green,2:blue`. **Aucune** hypothèse main gauche/droite : à fixer après `npm run capture`. |
| Doublons | état booléen par (source, canal, note) : NoteOn répétés idempotents, le premier NoteOff libère. Si deux producteurs envoient la même note sur la même source/canal, le premier NoteOff l'éteint. NoteOff orphelin ignoré. |
| NoteOn vel 0 | traité comme NoteOff. |
| Pédale (CC64 ≥ 64) | état « touche enfoncée » et « note tenue » distincts. `SUSTAIN_MODE=keys` (défaut) : LED = touche physique. `sound` : LED allumée tant que la note sonne. Pédale par source et par canal. |
| CC 120 / 123 / 124-127 | efface touches **et** notes tenues de ce canal et de cette source uniquement (plus strict que la norme, pour éviter les LED bloquées). CC 121 relâche la pédale. |
| Notes hors mapping | ignorées pour l'éclairage (compteur `unmapped`, journal en `LOG_LEVEL=debug`), **toujours routées** vers Synthesia. |
| Mapping | linéaire par défaut (`MIDI_BASE_NOTE=21` → LED 0, non calibré) ou table JSON (`NOTE_MAP_FILE`). Tout indice hors `[0,79]` est refusé au chargement. |
| Envoi DDP | trame complète 240 octets, 1 paquet, unicast. Sur changement : envoi au tour de boucle suivant (`COALESCE_MS=0`, les événements reçus ensemble partagent une trame), espacement minimal `MIN_FRAME_GAP_MS=5` (sous Windows, attendu sur la boucle d'événements car les timers y sont arrondis à ~15 ms). Keepalive à `FPS=40`. Un seul socket → ordre préservé. Séquence DDP 1..15 (0 = « non utilisé » dans la norme DDP). |
| Arrêt | `Ctrl+C`/SIGTERM : `BLACK_FRAMES_ON_STOP` trames noires puis fermeture du socket. **L'extinction n'est pas garantie** si le réseau ou le contrôleur est injoignable (UDP sans accusé). |
| Panic | `panic`, `panic k`, `panic s` sur l'entrée standard du service ; `kill -USR1 <pid>` sous Linux ; automatique pour une source à la déconnexion de son port. |
| Déconnexion | un port MIDI qui disparaît → seules les notes de **cette** source sont effacées ; reconnexion automatique (sondage `PORT_POLL_MS`). Une session RTP-MIDI dont le port ALSA reste présent n'est **pas** détectable ainsi : option `SYNTH_STALE_MS`. |
| Réseau DDP | UDP ne détecte pas la perte du contrôleur : seules les erreurs locales d'envoi (`EHOSTUNREACH`…) sont comptées. Le keepalive renvoie l'état courant, donc le ruban se resynchronise dès que le lien revient. |
| Boucles MIDI | clavier → Synthesia uniquement ; Synthesia → LED uniquement ; rien n'est renvoyé au clavier ; refus de démarrer si clavier et Synthesia désignent le même port d'entrée ; `ECHO_GUARD_MS` si Synthesia renvoie l'entrée sur sa sortie. |

## Métriques : ce qu'elles mesurent (et ne mesurent pas)

`stats` (simulateur) et l'arrêt du service affichent : événements traités, trames envoyées et fps réels,
intervalles entre trames, attente « changement → appel `send()` », délai de rappel de `send()`.
Ce sont des mesures **côté émetteur Node.js**. Elles **ne mesurent pas la latence optique** (réception WLED, rendu,
rafraîchissement du ruban). Méthodes de mesure de bout en bout : [docs/VALIDATION.md](docs/VALIDATION.md#méthodes-de-mesure).

## Commandes npm

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires (état, priorités, mapping, DDP, scheduler, routeur, config) |
| `npm run demo:<scenario>` / `demo:all:dry` | scénarios sur le ruban / sans réseau |
| `npm run sim` / `sim:dry` | simulateur interactif |
| `npm run ddp:legacy` | test DDP d'origine, inchangé |
| `npm run play -- <fichier.mid>` / `play:demo` / `midi:sample` | lecture d'un fichier MIDI sur les LED / démo / génération de l'exemple |
| `npm run ports` | liste des ports MIDI + `aconnect -l` / `amidi -l` (Linux) |
| `npm run capture -- --seconds 60` | capture des messages Synthesia, résumé par canal, JSON dans `captures/` |
| `npm run kbd-test [-- --mode live]` | chemin clavier → Synthesia + vérification blanc |
| `npm run diag` / `npm start` | service étape 3 avec / sans journal détaillé |
| `npm run rtt` + `npm run echo:windows` | mesure RTT RTP-MIDI Pi ↔ Windows |
