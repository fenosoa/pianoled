# Mode karaoké LED

Le Pi se connecte (client WebSocket) au hub du lecteur d'accords (`web_chords_karaoke`, chemin `/sync`) et allume **toutes les touches** dont la note appartient à l'accord en cours.

| Mode | LEDs |
| --- | --- |
| PAUSE (défaut) | Comportement habituel : MIDI → LEDs |
| KARAOKÉ | Uniquement l'accord reçu. Le MIDI est lu mais n'éclaire rien |

Transitions (chacune est loggée avec sa cause) : `song`/`chord` → KARAOKÉ ; `idle`, WebSocket coupé, ou aucun `chord` depuis `pauseTimeoutS` → PAUSE.

## Lancement

```bash
npm install            # installe aussi `ws` (nécessaire si Node < 22 ou pour fake_player)
# config/karaoke.json : "enabled": true et "wsUrl": "ws://<ip du PC>:5180/sync"
npm start              # ou: node src/cli/run.js --karaoke  (force l'activation)
```

Le Pi peut démarrer avant le lecteur : reconnexion automatique (1 s, 2 s, 5 s, puis toutes les 5 s). Au `connect` le client envoie `{"type":"hello","role":"follower"}` (requis par le hub pour diffuser). Avec `"enabled": false` et sans `--karaoke`, rien ne change.

## Configuration : `config/karaoke.json`

| Clé | Rôle |
| --- | --- |
| `enabled` | Active le mode karaoké |
| `wsUrl` | URL du hub (`ws://IP:5180/sync`) |
| `pauseTimeoutS` | Retour en PAUSE sans `chord` depuis N s (`0` = jamais) |
| `fadeMs` | Durée du fondu entre accords (`0` = coupure franche) |
| `onNoChord` | Accord vide / `N.C.` / inconnu : `off` éteint, `hold` garde le dernier |
| `brightness.pause` | Multiplicateur (0–1) de la luminosité en PAUSE (`1` = inchangé, `BRIGHTNESS` du `.env`) |
| `brightness.karaoke` | Luminosité (0–1) du mode karaoké |
| `bassColor` | Couleur de la basse (`D/F#` : F# en rouge sur la moitié gauche du clavier seulement) |
| `defaultColor` | Couleur d'un accord absent de `chordColors` |
| `chordColors` | Couleur par accord : clé `"Em"` (mineur) sinon clé `"E"` (racine). `C#` et `Db` sont équivalents |

Variable d'environnement `KARAOKE_CONFIG` pour utiliser un autre fichier.

## Test sans le vrai lecteur

```bash
node tools/karaoke/fake_player.js --port 5180 --step 3    # envoie song, Em, C, G, D/F#, D, (state), idle
# autre terminal : lancer le service avec wsUrl = ws://127.0.0.1:5180/sync
npm test                                                   # inclut test/karaoke.test.js (parser, contrôleur, client)
```

## Accords acceptés

`C`, `C#`, `Db`, `Em`, `E:min`, `G7`, `A:7`, `Cmaj7`, `D:min7`, `dim`, `aug`, `sus2`, `sus4`, `6`, `m6`, `9`… (9 et plus → accord de 7e), `m7b5`, `5`, basse `G/B` (ou intervalle Chordify `E:min/b3`).

## Côté lecteur (web_chords_karaoke)

Le lecteur émet `chord` (accord affiché, renvoyé chaque seconde pendant la lecture, ce qui réarme le timeout du Pi) et `idle` (pause, fin de morceau). Le hub `/sync` relaie ces messages sans les mettre en cache ; il envoie `idle` à un suiveur qui arrive pendant une pause et à tous les suiveurs si le lecteur se déconnecte. Relancer le serveur Vite (port 5180) et recharger la page du lecteur pour en profiter.

## Les 3 modes

| Mode | Quand | LEDs |
| --- | --- | --- |
| SYNTHESIA | `enabled: false`, ou forcé par le bouton Stream Deck | MIDI → LEDs (comportement historique) |
| IDLE | `enabled: true`, état par défaut | Vague arc-en-ciel gauche → droite sur toutes les LEDs, réactive aux touches jouées (voir ci-dessous). Les touches/notes MIDI s'allument par-dessus comme en SYNTHESIA |
| KARAOKE | `enabled: true`, `song`/`chord` reçus | Même vague arc-en-ciel gauche → droite, non réactive. Les touches de l'accord en cours s'affichent par-dessus (non ondulées) |

### Ondulations (`ripple` dans `config/karaoke.json`)

- La vague est une couche de fond : elle n'apparaît que sur les LEDs noires. SYNTHESIA n'a jamais de vague.
- **IDLE** : chaque touche du clavier jouée lance un anneau qui s'étend des deux côtés depuis sa LED, couleur selon la note (do, ré, mi… = teintes différentes), plus fort si la vélocité est élevée. La vague accélère tant qu'on joue puis revient à sa vitesse normale (~1,5 s).
- **KARAOKE** : vague constante, aucune réaction aux touches.

| Clé | Rôle |
| --- | --- |
| `ripple.enabled` | `false` désactive les vagues (IDLE = MIDI seul, KARAOKE = accord seul) |
| `ripple.brightness` | Luminosité de la vague (0–1) ; les anneaux sont plus lumineux |
| `ripple.speed` | Vitesse de la vague en LEDs/s |
| `ripple.wavelength` | Distance entre deux crêtes, en LEDs |
| `ripple.fps` | Fréquence de rafraîchissement de l'animation |

Avec `enabled: false` le Pi ne se connecte pas au lecteur : SYNTHESIA seul.

## Commandes manuelles (Stream Deck)

- `GET|POST http://192.168.1.39:5180/control/led/idle` : message `{"type":"idle","manual":true}`. Le Pi passe en IDLE ; le lecteur continue d'envoyer ses `chord`, donc le prochain relance le KARAOKE (pas de blocage). Sort aussi de SYNTHESIA.
- `GET|POST http://192.168.1.39:5180/control/led/synthesia` : message `{"type":"synthesia"}`. Le Pi passe en SYNTHESIA et **ignore `song`, `chord` et `idle` du lecteur** jusqu'à un idle manuel. Une déconnexion WebSocket le remet en IDLE.

Le timeout de 30 s (KARAOKE → IDLE) reste actif en parallèle.
