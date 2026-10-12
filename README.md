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

Exemple avec `C:\Dev\PianoLed\ownpianoled\love.mid` (format 1, 2 pistes, 1039 notes sur le canal 1, D1..E6, 3 min 55 s : tout tient dans les 80 LED avec le mapping par défaut) :

```powershell
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --info          # analyse : pistes, canaux, tessiture, couleur prévue
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid                 # lecture complète, notes en vert (source Synthesia)
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --source keyboard   # même morceau en blanc (source clavier)
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --seconds 30 --leds # 30 premières secondes + ligne des LED
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --start 60 --seconds 20 --speed 0.5
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --dry-run           # sans réseau, métriques seules
```

`love.mid` n'utilise qu'un canal : `--keyboard-channels` ne peut pas y séparer les mains. Pour tester le chevauchement blanc/vert, utiliser l'exemple généré à deux canaux :

```powershell
npm run midi:sample                                   # génère samples/demo-two-hands.mid (ch1 mélodie, ch2 accords)
npm run play:demo                                     # toutes les notes = source Synthesia (vert/bleu par canal)
npm run play -- samples/demo-two-hands.mid --keyboard-channels 1   # ch1 en blanc (clavier), ch2 en vert
npm run play -- samples/demo-two-hands.mid --keyboard-tracks 2 --speed 0.5 --transpose -12 --leds
```

Options : `--source synthesia|keyboard`, `--keyboard-channels 1,2`, `--keyboard-tracks 2` (numéros affichés par `--info`), `--speed`, `--transpose`, `--start`/`--seconds`, `--include-drums` (canal 10 ignoré par défaut), `--leds` (ligne des LED toutes les 100 ms), plus `--dry-run`, `--host`, `--fps`.
Les couleurs suivent les règles convenues : clavier rose `#FF4D9D`, Synthesia `#00CFF5` (ou selon `SYNTH_CHANNEL_COLORS`), même note sur les deux sources `#C5FF58`, notes hors mapping non éclairées.
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
| Priorité | clavier + Synthesia sur la même note → `COLOR_OVERLAP` (`#C5FF58`) ; clavier seul → `COLOR_KEYBOARD` (`#FF4D9D`) ; Synthesia seul → couleur du canal ; sinon éteint. Plusieurs canaux Synthesia sur la même note : le plus petit numéro de canal l'emporte. |
| Couleur Synthesia | `SYNTH_DEFAULT_COLOR` (défaut **synthesia** = `COLOR_SYNTHESIA`, `#00CFF5`, pour tous les canaux) + `SYNTH_CHANNEL_COLORS=1:green,2:blue`. **Aucune** hypothèse main gauche/droite : à fixer après `npm run capture`. |
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

## Référence des commandes

Toutes les commandes se lancent depuis `C:\Dev\PianoLed\ownpianoled` (ou `~/ownpianoled` sur le Pi).
Les options se placent après `--` : `npm run <script> -- <options>`. Chaque script npm correspond à `node <fichier>` : on peut aussi l'appeler directement (par ex. `node src/cli/play-midi.js love.mid`).

**Options communes** à `demo:*`, `sim`, `play`, `start`/`diag`, `kbd-test` :

| Option | Effet | Exemple |
|---|---|---|
| `--dry-run` | aucun paquet réseau, compteurs seulement | `npm run demo:all -- --dry-run` |
| `--host IP` | remplace `WLED_HOST` | `npm run demo:overlap -- --host 192.168.1.41` |
| `--fps N` | remplace `FPS` (keepalive) | `npm run demo:fast -- --fps 60` |
| `--log debug` | journal détaillé (notes hors mapping…) | `npm run play -- love.mid --log debug` |

Les réglages peuvent aussi être passés par variable d'environnement, sans modifier `.env` :

```powershell
$env:BRIGHTNESS="0.1"; npm run demo:all            # PowerShell
$env:SYNTH_CHANNEL_COLORS="1:green,2:blue"; npm run play:demo
Remove-Item Env:BRIGHTNESS                          # revenir au .env
```
```bash
BRIGHTNESS=0.1 npm run demo:all                     # bash (Raspberry Pi)
```

### Tests

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires : normalisation MIDI, état, priorités, mapping, DDP, scheduler, routeur, config, fichiers .mid |
| `npm run ddp:legacy` | test DDP d'origine (`test-ddp.js`, inchangé) : point vert qui parcourt les 80 LED pendant 10 s |

```powershell
npm test
node --test test/engine.test.js      # un seul fichier de test
npm run ddp:legacy
```

### Scénarios de démonstration (étape 2)

| Commande | Rôle |
|---|---|
| `npm run demo:single` | une note clavier (blanc) puis une note Synthesia (vert) |
| `npm run demo:chord` | accords simultanés des deux sources, relâche partielle |
| `npm run demo:overlap` | même note : Synthesia → clavier blanc → retour Synthesia → off (ch1 puis ch2) |
| `npm run demo:scale` | gamme chromatique montante (clavier) puis descendante (Synthesia) |
| `npm run demo:fast` | 3000 événements aléatoires rapides, deux sources, métriques |
| `npm run demo:edge` | notes hors mapping, vélocité 0, répétitions, pédale, All Notes Off |
| `npm run demo:panic` | remise à zéro d'une source puis de toutes |
| `npm run demo:sweep` | allume chaque note une à une (aide à la calibration note → LED) |
| `npm run demo:all` | single, chord, overlap, edge, panic, fast |
| `npm run demo:all:dry` | idem sans réseau |

Option propre : `--hold MS` (durée de maintien des notes, défaut 400).

```powershell
npm run demo:overlap
npm run demo:overlap -- --hold 1000            # plus lent, pour bien observer
npm run demo:sweep -- --hold 200
npm run demo:all -- --dry-run
$env:SYNTH_CHANNEL_COLORS="1:green,2:blue"; npm run demo:overlap   # ch1 vert, ch2 bleu
```

### Simulateur interactif

| Commande | Rôle |
|---|---|
| `npm run sim` | invite de commandes, envoi sur le ruban |
| `npm run sim:dry` | idem sans réseau |

Commandes dans l'invite (canaux 1..16) :

| Saisie | Effet |
|---|---|
| `k 60` / `k 60 30` | note 60 clavier (vélocité 100 / 30) |
| `ku 60` | relâche la note 60 clavier |
| `s 60` / `s 60 2` | note 60 Synthesia canal 1 / canal 2 |
| `su 60 2` | relâche la note 60 Synthesia canal 2 |
| `ped 1 k` / `ped 0 k` | pédale de sustain clavier enfoncée / relâchée (`s` pour Synthesia) |
| `panic` / `panic k` / `panic s` | efface tout / le clavier / Synthesia |
| `run overlap` | lance un scénario |
| `led` / `stats` | ligne des LED / métriques |
| `q` | quitte (trames noires) |

```text
> s 60 2
  .......................................G........................................
> k 60
  .......................................W........................................
> ku 60
  .......................................G........................................
```

### Lecture de fichiers MIDI

| Commande | Rôle |
|---|---|
| `npm run play -- <fichier.mid> [options]` | rejoue un fichier .mid sur les LED (voir options plus haut) |
| `npm run midi:sample` | génère `samples/demo-two-hands.mid` |
| `npm run play:demo` | joue `samples/demo-two-hands.mid` |

```powershell
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --info
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --source keyboard --seconds 45
npm run play -- C:\Dev\PianoLed\ownpianoled\love.mid --start 90 --seconds 30 --speed 1.5 --leds
npm run play -- samples/demo-two-hands.mid --keyboard-channels 1
```

### Étape 3 : ports MIDI, Synthesia, service

| Commande | Rôle |
|---|---|
| `npm run ports` | liste les ports MIDI vus par l'application, indique ce que trouvent les sous-chaînes du `.env` ; sous Linux ajoute `aconnect -l` et `amidi -l` |
| `npm run capture` | enregistre ce qu'envoie Synthesia (`--seconds`, défaut 30 ; `--port` ; `--quiet`), résumé par canal, JSON dans `captures/` |
| `npm run kbd-test` | injecte une gamme comme si elle venait du clavier → Synthesia + LED blanches (`--hold MS`) |
| `npm run kbd-test -- --mode live` | vous jouez au clavier pendant `--seconds` ; compare messages reçus / transmis / LED blanches |
| `npm start` | service : clavier → Synthesia + LED, Synthesia → LED |
| `npm run diag` | service + journal de chaque message + état des LED et ports (`--status-every MS`, défaut 5000) |

Commandes au clavier pendant `npm start` / `npm run diag` : `panic`, `panic k`, `panic s`, `status`, `stats`, `q`.

```bash
npm run ports
npm run capture -- --seconds 60
npm run capture -- --port "rtpmidid" --seconds 120 --quiet
npm run kbd-test
npm run kbd-test -- --mode live --seconds 30
npm run diag
npm run diag -- --status-every 2000 --dry-run
npm start
kill -USR1 $(pgrep -f src/cli/run.js)          # panic depuis un autre terminal (Linux)
```

### Mesure du RTT RTP-MIDI

| Commande | Où | Rôle |
|---|---|---|
| `npm run echo:windows -- --list` | Windows | liste les ports rtpMIDI |
| `npm run echo:windows -- --in "<session>" --out "<session>"` | Windows | renvoie les notes du canal 16 |
| `npm run rtt` | Pi | envoie des sondes et mesure l'aller-retour (`--count`, `--interval`, `--timeout`, `--in`, `--out`) |

```powershell
npm run echo:windows -- --in "APPDEV10" --out "APPDEV10"     # nom de session observé, à adapter
```
```bash
npm run rtt -- --count 500 --interval 20
```

### Service systemd (Raspberry Pi)

```bash
sudo cp deploy/pianoled.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pianoled
sudo systemctl status pianoled
journalctl -u pianoled -f
sudo systemctl kill -s USR1 pianoled      # panic
sudo systemctl restart pianoled
sudo systemctl stop pianoled              # trames noires puis arrêt
```
