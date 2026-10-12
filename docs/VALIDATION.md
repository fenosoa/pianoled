# Journal de validation

Légende : ✅ vérifié · 🟡 vérifié partiellement · ⏳ à faire / à confirmer par l'utilisateur.

## Étape 1 — Existant

| Élément | Résultat |
|---|---|
| `test-ddp.js` (80 LED, 40 Hz, DDP 4048) | Conservé **sans modification** ; `npm run ddp:legacy`. L'en-tête DDP du nouveau code est identique octet pour octet (test `DDP header matches the validated test-ddp.js layout`), seule différence : séquence 1..15 au lieu de 0..15 (0 = « non utilisé » dans la norme DDP). |

## Étape 2 — Moteur MIDI/LED (Windows 11, Node 22.11, 2026-10-11)

| Test | Commande | Résultat |
|---|---|---|
| Tests unitaires (normalisation, état, priorités, mapping, DDP, scheduler, routeur, config) | `npm test` | ✅ 44/44 |
| Scénarios sans réseau | `npm run demo:all:dry` | ✅ toutes vérifications PASS |
| Scénarios sur le GLEDOPTO `192.168.1.41` (ping 6 ms) | `npm run demo:all` | ✅ 105 vérifications PASS, 0 erreur d'envoi UDP |
| Rendu visuel réel sur les 80 LED (couleurs, polyphonie, chevauchement, extinction) | `npm run demo:all`, `npm run demo:overlap` en regardant le ruban | ✅ confirmé visuellement par l'utilisateur (2026-10-11) |

Métriques côté émetteur, scénario `fast` sur le réseau réel (3000 événements aléatoires, deux sources) :

```text
frames sent      : 759 in 12.08s -> 62.8 fps (change=749 keepalive=10 coalesced=1652)
frame interval   : min=14.02 p50=15.84 p95=16.28 p99=30.86 max=32.35 ms
change->send wait: min=0.02 p50=0.09 p95=0.32 p99=0.50 max=0.95 ms
send() callback  : min=0.04 p50=0.12 p95=0.21 p99=0.32 max=0.43 ms
```

Lecture honnête :
- L'intervalle ~16 ms reflète le **générateur** de test (`setTimeout(2)` ≈ 15,6 ms sous Windows) : les événements arrivent par paquets, chacun produisant une trame. Ce n'est pas une limite du moteur.
- « change → send » (< 1 ms) et « send() callback » mesurent uniquement le temps passé dans Node.js jusqu'à la remise du datagramme au système.
- **Aucune** de ces valeurs n'est une latence optique.

## Étape 3 — MIDI réel et RTP-MIDI

| Test | Résultat |
|---|---|
| Routeur : clavier transmis tel quel, Synthesia jamais réinjecté, priorité, déconnexion d'une source, garde anti-écho (tests unitaires avec ports simulés) | ✅ |
| Reconnexion automatique d'un port qui disparaît/réapparaît (test unitaire) | ✅ |
| `@julusian/midi` sous Windows : énumération (port `APPDEV10` observé en entrée et sortie) et ouverture réelle du port en dry-run | ✅ |
| Installation sur Raspberry Pi 5, `rtpmidid`, ports ALSA | ✅ Debian 13 trixie aarch64, Ethernet 192.168.1.44, rtpmidid fonctionnel, clavier `Oxygen 61` et session `APPDEV10` détectés (2026-10-11) |
| Type de raccordement du clavier | ✅ **USB** (confirmé 2026-10-11) — modèle class compliant à vérifier au branchement sur le Pi (`aconnect -l`) |
| Règle vert/bleu de Synthesia (`npm run capture`) | ⏳ — par défaut tout canal = vert |
| Critère 1 : touche → LED blanche + note reçue par Synthesia | ✅ `npm run diag`, confirmé par l'utilisateur (2026-10-11) ; transmission vers Synthesia par routage ALSA (`FORWARD_KEYBOARD=0`) |
| Critère 2 : Synthesia → LED vert/bleu selon la règle observée | 🟡 LED vertes confirmées (2026-10-11) ; règle vert/bleu à fixer après `npm run capture` |
| Critère 3 : deux flux simultanés, sans feedback | 🟡 fonctionnement simultané confirmé par l'utilisateur ; compteurs `echoDrop` et test d'écho à consigner |
| Critère 4 : séquences rapides + métriques | ⏳ sur le Pi : `npm run demo:fast`, `npm run rtt` |
| Critère 5 : déconnexion/reconnexion sans LED bloquées | ⏳ SETUP-RPI §4 point 6 |

## Méthodes de mesure

1. **Côté émetteur** (fourni) : métriques du scheduler ci-dessus — temps logiciel uniquement.
2. **Réseau RTP-MIDI** (fourni) : `npm run rtt` (Pi) + `npm run echo:windows` (Windows). Horloge monotone unique côté Pi, aucune synchronisation d'horloges nécessaire. Résultats : RTT min/p50/p95/p99/max, écart-type, pertes ; un sens ≈ RTT/2 (hypothèse de symétrie, à mentionner avec le résultat). Ne mesure ni Synthesia ni les LED.
3. **Optique de bout en bout** (manuel) : filmer au ralenti (≥ 240 i/s, soit ~4 ms de résolution) la touche et la LED dans le même plan ; compter les images entre l'enfoncement complet de la touche et l'allumage de la LED sur ≥ 30 essais ; reporter médiane, p95 et dispersion. Pour Synthesia → LED, filmer l'écran de Synthesia et le ruban (ajouter la latence d'affichage de l'écran comme incertitude).

| Mesure | Valeur | Conditions |
|---|---|---|
| RTT RTP-MIDI Pi ↔ Windows | ⏳ | Pi en Ethernet (192.168.1.43) |
| Latence optique clavier → LED | ⏳ | |
| Latence optique Synthesia → LED | ⏳ | |

## Limites connues

- UDP : ni la perte d'un paquet DDP ni l'indisponibilité du contrôleur ne sont détectables ; le keepalive resynchronise l'état dès le retour du lien. L'extinction à l'arrêt n'est pas garantie.
- Une session RTP-MIDI interrompue dont le port ALSA reste présent n'est pas détectée par le sondage des ports ; `SYNTH_STALE_MS` (désactivé par défaut) efface les LED Synthesia après un silence, au risque d'éteindre une note très longue.
- Mapping linéaire non calibré : `MIDI_BASE_NOTE=21` → LED 0 est une hypothèse de prototype. Calibrer avec `npm run demo:sweep` / `npm run diag` puis une table `NOTE_MAP_FILE`.
- Sous Windows, les signaux envoyés par `timeout` de Git Bash ne sont pas remis à Node : arrêter avec `Ctrl+C` dans une console, ou `q` en mode interactif.
