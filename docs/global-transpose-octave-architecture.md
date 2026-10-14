# Transposition et décalage d'octave : architecture (phase 1)

Statut : **implémenté** avec les décisions suivantes (réponses au §12) : LED inchangées (gérées par `.env`) ; anti-écho et garde d'écho du PSR mis de côté ; `psrTransposeAppliesToMidiIn` supprimé (le PSR ne transpose pas les notes reçues, testé) ; `FORWARD_KEYBOARD=1` toujours, sans avertissement ; pas de relâchement à la déconnexion du clavier ; application à chaud par IPC + `POST /api/pitch`. Les sections 6 et 8 et le paramètre booléen sont donc sans objet.

## 1. Constat sur le dépôt

Le routage MIDI se fait dans [src/adapters/router.js](../src/adapters/router.js) (classe `MidiRouter`). Il manipule soit des octets bruts, soit des événements normalisés produits par `parseMessage` ([src/midi/messages.js](../src/midi/messages.js)).

| Élément | Où | Comportement actuel |
|---|---|---|
| Clavier → Synthesia | `onKeyboard` | Les octets bruts sont renvoyés **tels quels** vers `synthesiaOut` *avant* le parsing, puis l'événement va au moteur LED (source `keyboard`). |
| Synthesia → clavier (son) | `onSynthesia` → `forwardToKeyboard` | Si `FORWARD_SYNTHESIA=1`, les octets bruts de tout message de canal sont envoyés à `keyboardOut`. `heldToKeyboard` (`canal:note`) et `pedalToKeyboard` servent à relâcher à la déconnexion et à l'arrêt. |
| Synthesia → LED | `onSynthesia` → `engine.handle` | L'événement normalisé alimente le moteur (source `synthesia`). |
| Anti-écho | `echoKey` / `isEcho` / `recentForwards` | Mémorise `type:canal:note` des événements clavier retransmis. Un message Synthesia identique dans les `ECHO_GUARD_MS` est écarté avant LED et avant `keyboardOut`. Il compare donc des numéros de note **dans l'espace où Synthesia les voit**. |
| Moteur LED | [src/engine.js](../src/engine.js), [src/state/note-state.js](../src/state/note-state.js), [src/mapping/note-map.js](../src/mapping/note-map.js) | Reçoit `event.note`. Le mapping note → LED, les couleurs et la priorité sont indépendants du routage. |
| Configuration | [src/config/index.js](../src/config/index.js), [src/control/schema.js](../src/control/schema.js), [src/control/env-store.js](../src/control/env-store.js) | Variables `.env` validées par `loadConfig`. L'UI les lit via le schéma, écrit le `.env` puis **redémarre** le service enfant ([src/control/runner.js](../src/control/runner.js)). Le seul canal à chaud existant est l'IPC `{type:'panic'}`. |
| Messages « other » | `parseMessage` | Aftertouch polyphonique (0xA0), program change, pitch bend et aftertouch de canal sont reconnus comme `other`. Ils sont retransmis bruts vers Synthesia et vers le clavier. **L'aftertouch polyphonique porte un numéro de note** et est donc concerné (décision 4). |

Deux écarts avec le brief, à connaître :

1. **Nombre de LED** : le code fixe `LED_COUNT = 120` ([src/constants.js](../src/constants.js), `.env.example`), pas 80. Cette fonctionnalité n'y touche pas. À confirmer de votre côté (voir §12).
2. **Routage ALSA direct** : [docs/SETUP-RPI.md](SETUP-RPI.md) documente le mode B (`FORWARD_KEYBOARD=0`, `aconnect clavier → rtpmidid`). Dans ce mode, l'application ne voit pas le flux avant Synthesia et **ne peut pas le compenser**. Voir §6.

## 2. Diagramme existant

```
                       (octets bruts, inchangés)
 PSR MIDI OUT ──► keyboardIn ──┬────────────────────────► synthesiaOut ──► Synthesia
                               └─ parseMessage ─► engine.handle(source=keyboard) ─► LED

 Synthesia ──► synthesiaIn ─► parseMessage ─► [isEcho ?] ─┬─ (octets bruts, FORWARD_SYNTHESIA) ─► keyboardOut ─► PSR MIDI IN
                                                          └─ engine.handle(source=synthesia) ─► LED
```

## 3. Modèle de hauteur et formules

Trois espaces de notes :

1. **Référence** : numéros des morceaux Synthesia, égaux aux positions physiques des touches. Utilisé par les LED, la validation Synthesia et l'anti-écho.
2. **Sortie sonore** : numéros envoyés au PSR.
3. **Entrée physique** : numéros émis par le PSR après sa propre transposition et son décalage d'octave.

```
audioShift         = audioTransposeSemitones + 12 * audioOctaveShift
keyboardInputShift = keyboardPhysicalTransposeSemitones + 12 * keyboardPhysicalOctaveShift

A. noteToPsr               = noteFromSynthesia + audioShift_eff
C/D. referenceNoteFromKbd  = noteFromPsr - keyboardInputShift
```

avec, pour `psrTransposeAppliesToMidiIn` (§8) :

```
audioShift_eff = audioShift - (psrTransposeAppliesToMidiIn ? keyboardPhysicalTransposeSemitones : 0)
```

Seule la transposition du PSR est soustraite, pas son décalage d'octave. Le brief ne dit pas que l'octave physique s'applique aussi aux notes reçues, et ce n'est pas mesuré.

Sortie sonore et compensation clavier restent deux opérations indépendantes : aucun lien de signe entre elles.

**Invariant** : si `keyboardInputShift` égale le décalage réel du PSR, la note de référence est la touche physique. Les LED et la validation Synthesia ne dépendent que de l'espace de référence, quels que soient les réglages audio.

### Exemples numériques

| Cas | Calcul | Résultat |
|---|---|---|
| Nominal : audio −3, PSR −3, touche 67 | PSR émet 64, 64 − (−3) = 67 | Synthesia et LED reçoivent 67. L'accompagnement Synthesia 67 devient 64 au PSR. |
| Synthesia 67, audio −3, octave −1 | `audioShift` = −15 | 52 au PSR, LED 67 |
| Touche 67, PSR +3, octave +1 | `keyboardInputShift` = +15, reçu 82 | 82 − 15 = 67 |
| Touche 67, PSR −2, octave −1 | `keyboardInputShift` = −14, reçu 53 | 53 + 14 = 67 |
| Tout à zéro | décalage 0 | identité stricte |

## 4. Diagramme cible

```
                      PSR MIDI OUT (espace « entrée physique »)
                               │
                        keyboardIn
                               │  parse + normalisation UNIQUE  (PitchMapper.fromKeyboard, table d'état « kbd »)
                               ▼
                    événement normalisé (espace RÉFÉRENCE), calculé une fois
                    ├──► C : octets reconstruits ─► synthesiaOut ─► Synthesia
                    ├──► D : engine.handle(source=keyboard) ─► LED
                    └──► clé anti-écho (espace référence)

 Synthesia ──► synthesiaIn ─► parse (espace RÉFÉRENCE) ─► [isEcho, espace référence ?]
                                      ├──► B : engine.handle(source=synthesia) ─► LED     (note INCHANGÉE)
                                      └──► A : PitchMapper.toPsr (table d'état « syn ») ─► keyboardOut ─► PSR MIDI IN
```

Le point central : les décalages ne touchent que deux endroits, **A** (juste avant `keyboardOut`) et **C/D** (juste après le parsing clavier). Le moteur LED, le mapping, les couleurs et la priorité ne sont pas modifiés.

## 5. Composants

### 5.1 Fonctions pures de hauteur (nouveau : `src/midi/pitch.js`)

Sans état ni effet de bord :

```js
shiftNote(note, delta) → number | null   // null si hors [0,127] : ni wrap, ni modulo, ni clamp
audioShiftOf(cfg)      → number          // audioShift_eff
keyboardShiftOf(cfg)   → number          // keyboardInputShift
```

### 5.2 `PitchMapper` (nouveau, avec état)

Une instance unique, partagée par A et C/D. Il contient la table d'état des notes émises (décision 1) :

```
key = source : canal : noteOrigine   →   noteEmise | DROPPED
```

- **Note On** : calcule `noteEmise` avec le réglage *courant*, enregistre l'entrée (ou `DROPPED` si hors plage), et renvoie la note à utiliser ou `null`.
- **Note Off** (et Note On vélocité 0, déjà converti en `noteoff` par `parseMessage`) : lit l'entrée, la supprime et renvoie `noteEmise`. Sans entrée, il utilise le réglage courant comme repli. Si l'entrée vaut `DROPPED`, il renvoie `null`.
- **Aftertouch polyphonique** : même table, sans création ni suppression d'entrée. Sans entrée, le message est ignoré. C'est ce que fait le PSR : il ignore l'aftertouch d'une note non tenue.
- **Note On répété sur une note déjà dans la table** (sans Note Off) : l'ancienne entrée est écrasée, comme la sémantique booléenne de `note-state.js` (« idempotent, le premier Note Off libère »). Si le réglage a changé entre-temps, l'ancienne note émise reste tenue côté PSR. Pour éviter cela, le `PitchMapper` renvoie un Note Off préalable de l'ancienne note (retrigger propre). Il n'est émis que lorsque l'ancienne note émise diffère de la nouvelle, donc **jamais quand tous les réglages sont à 0**.
- **Panic / déconnexion** : `releaseAll(source)` renvoie la liste des `(canal, noteEmise)` à fermer et vide la table. Il remplace `heldToKeyboard`, qui deviendrait faux dès qu'un décalage existe.

La table fait au plus 16 × 128 entrées par source : coût négligeable, aucune allocation notable par note.

### 5.3 Réglages à chaud

Pas d'appel HTTP par note. Le `PitchMapper` détient un objet de réglages en mémoire, modifiable via l'IPC enfant (même mécanisme que `{type:'panic'}`) : `{type:'pitch', audioTransposeSemitones, …}`. Le serveur de contrôle persiste ensuite dans `.env` via `EnvStore.write`, sans redémarrer le service. Les notes déjà tenues restent gérées par la table (décision 1).

## 6. Mode ALSA direct (FORWARD_KEYBOARD=0)

Dans ce mode, `aconnect` relie le clavier à `rtpmidid` sans passer par l'application : aucune compensation n'est possible.

Proposition : si `keyboardInputShift ≠ 0` **et** `FORWARD_KEYBOARD=0`, `loadConfig` renvoie un **avertissement** (jamais une erreur, pour ne pas bloquer le démarrage) et `docs/SETUP-RPI.md` impose le mode A (`FORWARD_KEYBOARD=1`) dès qu'une compensation clavier est utilisée. En mode B, les LED clavier seraient aussi décalées, car l'application les calculerait quand même à partir de la note normalisée, alors que Synthesia recevrait la note non compensée. Le mélange serait incohérent, d'où la nécessité de l'avertissement.

## 7. Anti-écho : analyse (risque prioritaire)

**Espace actuel de la détection.** `echoKey` est calculé sur l'événement clavier *brut*, avant toute transformation. Ce qui est comparé est la note que Synthesia a reçue puis réémise. Aujourd'hui, brut et référence sont identiques.

**Avec compensation clavier sans adaptation** : Synthesia reçoit `noteFromPsr − keyboardInputShift` et, s'il réécrit l'écho sur sa sortie, renvoie cette note. Or `recentForwards` contiendrait `noteFromPsr`. La clé ne correspondrait plus, l'écho passerait, serait transmis au PSR (via `forwardSynthesia`) avec `audioShift`, et allumerait les LED Synthesia : **boucle non détectée**.

**Faux positifs.** Le cas inverse existe aussi : une note Synthesia légitime égale par hasard à `noteFromPsr` pourrait être filtrée.

**Adaptation proposée.** La clé d'écho est calculée sur la note **normalisée** (espace référence), celle envoyée à Synthesia. L'écho revient dans ce même espace : la comparaison est correcte. Elle ne dépend pas de `audioShift`, qui n'intervient qu'après le test `isEcho`.

Cas supplémentaires :

- **Le PSR renvoie sur son MIDI OUT les notes reçues sur MIDI IN** (MIDI thru, Local Control, selon le modèle) : une note Synthesia transformée reviendrait sur `keyboardIn` et s'allumerait comme une note clavier, avec un décalage faux. Le dépôt n'a pas de garde pour ce cas aujourd'hui. Proposition **optionnelle** : `PitchMapper` expose les notes émises récemment au PSR (valeur et horodatage) et le routeur ignore une note clavier identique reçue dans `ECHO_GUARD_MS`. Désactivée par défaut, elle ne modifie pas le comportement à zéro. À confirmer (§12).
- **Note hors plage** : si la note clavier normalisée sort de `[0,127]`, elle n'est ni retransmise ni allumée, et aucune clé d'écho n'est créée.

## 8. Double transposition sonore

- `psrTransposeAppliesToMidiIn=false` (défaut) : le PSR ne transpose pas les notes reçues. `noteToPsr = note + audioShift`, le son vaut `note + audioShift`.
- `psrTransposeAppliesToMidiIn=true` : le PSR ajoute sa transposition aux notes reçues. On envoie `note + audioShift − keyboardPhysicalTransposeSemitones`, donc le son vaut aussi `note + audioShift`. Dans le scénario nominal (audio −3, PSR −3), le décalage envoyé est 0.
- **Local Control** : s'il est coupé, le PSR ne joue pas ses propres touches. Le son des touches dépend alors de l'écho Synthesia et du chemin choisi. Ce n'est pas géré par ce projet, et la documentation précisera qu'il doit rester actif (comme dans [SETUP-RPI.md](SETUP-RPI.md)).
- **Echo clavier → PSR** : l'application n'envoie jamais de notes clavier au PSR. La seule source de double son est un écho Synthesia, déjà traité par `isEcho` (§7).
- **Synthesia** ne doit appliquer ni transposition ni décalage d'octave. Cela sera ajouté dans [SETUP-WINDOWS.md](SETUP-WINDOWS.md) et le README.

## 9. Cycle de vie des notes (décision 1)

| Situation | Comportement |
|---|---|
| Accord | Une entrée de table par note ; chaque Note Off libère sa propre note émise. |
| Note répétée sans Note Off | Voir §5.2 (retrigger propre uniquement si le réglage a changé). |
| Note On vélocité 0 | Déjà un `noteoff` après `parseMessage` ; même chemin. |
| Sustain CC64 | Aucun décalage (pas une note). Le pédalier reste suivi par `pedalToKeyboard`. Les notes gardées par la pédale côté PSR ont déjà reçu leur Note Off *au bon numéro*. |
| Changement de réglage en cours de note | La note se termine sur son numéro d'origine (table). Les nouvelles notes utilisent le nouveau réglage. Pas de coupure globale. |
| Panic / All Notes Off (CC123) / All Sound Off (CC120) | CC non décalés. Côté LED, comportement actuel. Côté PSR, la table est vidée seulement pour les notes que le message ferme (même canal). |
| Changement de canal | La clé inclut le canal : pas de fuite entre canaux. |
| Déconnexion de `synthesiaIn` | `releaseAll('synthesia')` → Note Off aux numéros émis, pédales relevées, puis `engine.panic('synthesia')` (déjà fait). |
| Déconnexion de `keyboardIn` | `releaseAll('keyboard')` pour la branche vers Synthesia, puis `engine.panic('keyboard')`. À noter : aujourd'hui rien n'est relâché côté Synthesia pour le clavier. À valider si on l'ajoute (§12). |
| Arrêt du service | `releaseKeyboardOut` utilise la table. |
| Redémarrage | Table vide ; le PSR n'a plus de note ouverte par ce processus (Note Off envoyés à l'arrêt). |
| Note hors `[0,127]` | Ignorée, journalisée en debug avec limitation de débit (un message par note et par seconde au plus), entrée `DROPPED`. Le Note Off correspondant est donc ignoré. |

## 10. Temps réel

- Chemin chaud : une addition, une lecture/écriture de `Map`, aucune allocation sur la valeur de retour.
- Le clavier → Synthesia continue d'être **envoyé avant** le parsing LED. Seul l'ordre interne change : un parsing minimal (statut + note) a lieu avant l'envoi, uniquement si `keyboardInputShift ≠ 0`. À zéro, les octets bruts sont réutilisés (chemin actuel inchangé).
- Aucune modification de `frame-scheduler`, `renderer`, `note-map`, du DDP ni des ports.
- Aucun appel HTTP par note : les réglages arrivent par IPC (§5.3).

## 11. Configuration, UI, impact

Nouvelles clés `.env` (aucune obligatoire, valeurs par défaut `0` / `false`, donc rétrocompatible) :

| Clé | Type | Bornes | Défaut |
|---|---|---|---|
| `AUDIO_TRANSPOSE_SEMITONES` | int | −12..12 | 0 |
| `AUDIO_OCTAVE_SHIFT` | int | −3..3 | 0 |
| `KEYBOARD_PHYSICAL_TRANSPOSE_SEMITONES` | int | −12..12 | 0 |
| `KEYBOARD_PHYSICAL_OCTAVE_SHIFT` | int | −3..3 | 0 |
| `PSR_TRANSPOSE_APPLIES_TO_MIDI_IN` | bool | | 0 |

UI : un nouveau groupe « Hauteur » dans [src/control/schema.js](../src/control/schema.js), avec deux sous-blocs séparés « Sortie sonore » et « Compensation clavier ». Affichage combiné en lecture seule sous chaque bloc : par ex. « Total : −15 demi-tons (−1 octave, −3) ». Les paramètres restent distincts : le combiné est un résumé et non un champ saisissable. Application à chaud via le futur endpoint `POST /api/pitch`.

| Module | Impact |
|---|---|
| `src/midi/pitch.js` | **Nouveau**, fonctions pures |
| `src/adapters/router.js` | `PitchMapper` injecté ; A, C/D ; `echoKey` sur note normalisée ; `releaseAll` remplace `heldToKeyboard` |
| `src/config/index.js` | Cinq clés, avertissement §6 |
| `src/control/schema.js`, `server.js`, `runner.js`, `ui/src/*` | Groupe UI, IPC `pitch`, endpoint |
| `src/cli/run.js` | Câblage, bannière de statut, handler IPC |
| `src/engine.js`, `state/`, `mapping/`, `render/`, `ddp/` | **Aucun changement** |
| `.env.example`, README, SETUP-RPI, SETUP-WINDOWS | Documentation, avertissement « Synthesia sans décalage », limitation Split/Dual |

Mode Split/Dual (décision 3) : un seul `keyboardInputShift` global est appliqué. L'architecture prévoit une extension par canal MIDI en remplaçant la valeur scalaire par une fonction `(canal) → décalage`, sans changer la table d'état ni les fonctions pures.

## 12. Décisions et points ouverts

1. **LED : 80 ou 120 ?** Le code dit 120. Je ne touche à rien, mais confirmez que le code reste tel quel.
2. **Anti-écho (§7)** : acceptez-vous le changement de clé vers l'espace référence ? C'est indispensable dès que la compensation est active.
3. **Garde contre l'écho du PSR vers `keyboardIn` (§7)** : voulez-vous la garde optionnelle ? Elle est désactivée par défaut.
4. **Double transposition (§8)** : confirmez que `psrTransposeAppliesToMidiIn` soustrait **uniquement** la transposition en demi-tons, pas l'octave.
5. **Mode ALSA direct (§6)** : un avertissement suffit-il, ou préférez-vous une erreur de démarrage quand `keyboardInputShift ≠ 0` et `FORWARD_KEYBOARD=0` ?
6. **Relâchement des notes clavier vers Synthesia à la déconnexion (§9)** : à ajouter ou à garder tel quel ? C'est un changement de comportement, hors périmètre strict.
7. **Application à chaud (§5.3)** : valider IPC + endpoint plutôt qu'un redémarrage du service.

## 13. Plan de tests

Unitaires (`node --test`, dans `test/`) :

- `pitch.js` : formules, bornes, `null` hors plage, aucun wrap, identité à zéro, et les sept lignes de la matrice du brief.
- `PitchMapper` : accords, note répétée, Note Off après changement de réglage, note hors plage (Note Off ignoré), aftertouch polyphonique, `releaseAll`, canaux distincts.

Intégration (`router.test.js`, `FakeIn`/`FakeOut` existants) :

- Tous les réglages à zéro : séquences d'octets identiques aux tests actuels (non-régression).
- Scénario nominal ; touche 67 avec PSR +3 / +1 / −2 −1 ; Synthesia 67 avec audio −3 octave 0 et −1 : octets vers `keyboardOut`, **cellules LED inchangées**.
- Priorités et couleurs avec plusieurs sources.
- Anti-écho : écho Synthesia en espace référence écarté avec compensation active ; note légitime non filtrée.
- Changement de réglage pendant une note tenue ; sustain ; déconnexion et reconnexion ; `psrTransposeAppliesToMidiIn=true`.

Validation manuelle sur matériel (à ajouter à [VALIDATION.md](VALIDATION.md)) : scénario nominal complet, Split/Dual (limitation), reconnexion RTP-MIDI, mesure de latence avec `rtt-probe` avant/après.
