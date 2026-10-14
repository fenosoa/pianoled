# Fonctionnalité : transposition et décalage d'octave MIDI (sortie sonore et compensation clavier)

## Mission et règle de travail

Étendre le projet **déjà fonctionnel** Raspberry Pi 5 / RTP-MIDI / Yamaha PSR / Synthesia / GLEDOPTO WLED avec deux familles de réglages indépendantes :

- **sortie sonore** : transposition (demi-tons) et décalage d'octave appliqués aux notes Synthesia envoyées au PSR ;
- **compensation clavier** : inverse du décalage que le PSR applique déjà sur son MIDI OUT.

Les notes utilisées par Synthesia pour sa validation et les positions des LED restent toujours dans l'espace de référence des morceaux (G/Em).

**Phase 1 obligatoire : examiner le dépôt et proposer l'architecture, sans modifier le code applicatif. Attendre mon accord explicite avant la phase 2.** Respecter les modules, conventions, couleurs, routages et mécanismes anti-écho existants.

## Faits confirmés (ne pas revérifier)

- Les morceaux Synthesia sont préparés en **Sol majeur (G)** ou **Mi mineur (Em)** ; leur tonalité d'origine peut différer. La détection automatique de tonalité est hors périmètre.
- **Test effectué et confirmé : quand le PSR applique une transposition physique, les notes qu'il émet vers le Raspberry Pi sont déjà transposées.** Ne prévoir aucune phase de diagnostic matériel du PSR.
- GLEDOPTO ESP32, WLED 0.15.1, `192.168.1.41`, DDP/UDP port `4048`, **80 LED strictement fixes (index 0 à 79)**. Conserver le mapping MIDI→LED, la fusion des deux sources, leurs couleurs et leur priorité.
- Le routage MIDI bidirectionnel, Synthesia et le moteur LED fonctionnent. Préserver la suppression des boucles, la gestion des notes maintenues et la faible latence.
- Synthesia ne doit appliquer aucun décalage de son côté (octave clavier, transposition) : tous les décalages sont gérés par le Raspberry Pi et le PSR. Le signaler dans la documentation utilisateur.

## Invariant central

**Note de référence = position physique de la touche sur le clavier.**

Quand la compensation configurée est égale au décalage réellement appliqué par le PSR, la note normalisée correspond à la touche enfoncée. Conséquences :

- les LED s'allument sous la touche physique que l'utilisateur doit enfoncer ou vient d'enfoncer ;
- Synthesia valide la touche physique qu'il a demandée ;
- seul le **son** change de hauteur.

Toute proposition d'architecture doit respecter cet invariant ; c'est le critère de correction principal.

## Modèle de hauteur et convention de signes

Trois espaces de notes :

1. **Référence** : numéros MIDI des morceaux Synthesia = positions physiques des touches. Utilisé par les LED et la validation Synthesia.
2. **Sortie sonore** : numéros MIDI envoyés au PSR pour jouer le morceau dans sa hauteur cible.
3. **Entrée physique** : numéros MIDI émis par le PSR après sa transposition et son décalage d'octave physiques.

Paramètres entiers indépendants, valeur par défaut `0` :

| Paramètre | Rôle | Bornes proposées |
|---|---|---|
| `audioTransposeSemitones` | Décalage chromatique Synthesia → son PSR | `[-12, +12]` |
| `audioOctaveShift` | Décalage en octaves Synthesia → son PSR | `[-3, +3]` |
| `keyboardPhysicalTransposeSemitones` | Transposition effective sur le MIDI OUT du PSR | `[-12, +12]` |
| `keyboardPhysicalOctaveShift` | Décalage d'octave effectif sur le MIDI OUT du PSR | `[-3, +3]` |
| `psrTransposeAppliesToMidiIn` | Booléen : le PSR applique-t-il aussi sa transposition aux notes reçues sur MIDI IN ? | défaut `false` |

Les bornes sont des propositions modifiables dans le document d'architecture.

Les réglages physiques du PSR ne sont pas forcément numériquement identiques aux paramètres logiciels : c'est leur **valeur effective sur le MIDI OUT** que la configuration représente.

Formules :

- `audioShift = audioTransposeSemitones + 12 * audioOctaveShift`
- `keyboardInputShift = keyboardPhysicalTransposeSemitones + 12 * keyboardPhysicalOctaveShift`
- `noteToPsr = noteFromSynthesia + audioShift`
- `referenceNoteFromKeyboard = noteFromPsr - keyboardInputShift`

La sortie sonore et la compensation clavier sont **deux opérations distinctes**. Ne jamais les relier automatiquement par inversion de signe.

Si `psrTransposeAppliesToMidiIn = true`, le PSR ajoute déjà sa transposition aux notes Synthesia reçues : l'architecture doit proposer comment éviter la double transposition (par exemple soustraire la transposition physique de `audioShift`, ou documenter la configuration attendue). Ce booléen existe parce que ce comportement n'a pas été mesuré ; ne pas demander de test matériel.

Rappel musical : une transposition de `-3` convertit G majeur en E majeur ; elle ne change pas le mode.

## Scénarios de référence

**Scénario nominal (usage réel)** : morceau original en Mi majeur, préparé en Sol.
- `audioTransposeSemitones = -3` : l'accompagnement Synthesia sonne en Mi.
- Transposition physique PSR `-3`, donc `keyboardPhysicalTransposeSemitones = -3` : les touches jouées sonnent aussi en Mi.
- L'utilisateur enfonce la touche G4 (`67`) : le PSR émet `64`, compensation `+3`, Synthesia et LED reçoivent `67`.
- Son global cohérent en Mi ; LED et validation sur la disposition en Sol.

**Scénarios d'indépendance** : les autres exemples de ce document combinent volontairement des valeurs sans rapport musical (par exemple audio `-3` avec PSR `+3`) pour vérifier que les paramètres sont bien indépendants. Ils ne décrivent pas une relation entre eux.

## Flux fonctionnels

**A. Synthesia → Raspberry Pi → PSR (son)**
- Appliquer `audioShift` uniquement sur cette branche.
- Exemple : `67`, transpose `-3`, octave `-1` → `52` (E3).
- Ne jamais modifier la note transmise à la branche LED.

**B. Synthesia → Raspberry Pi → LED**
- Note de référence **inchangée**, quels que soient les réglages audio.

**C. PSR → Raspberry Pi → Synthesia**
- Appliquer `-keyboardInputShift` pour que Synthesia reçoive la note de référence.
- Exemple : touche `67`, transpose physique `+3`, octave physique `+1` → reçu `82`, compensation `-15`, transmis `67`.

**D. PSR → Raspberry Pi → LED clavier**
- Utiliser **la même note normalisée** qu'en C, calculée une seule fois.
- Le moteur existant reste responsable des couleurs, des chevauchements et de la priorité clavier.

## Décisions prises (à respecter sauf objection argumentée)

1. **Changement de réglage pendant une note tenue** : la note se termine naturellement. Son `Note Off` est envoyé au numéro réellement émis, grâce à une table d'état indexée par source, canal et note d'origine. Les nouvelles notes utilisent le nouveau réglage. Pas de coupure globale automatique au changement de réglage.
2. **Note hors `[0,127]` après décalage** : la note est ignorée et journalisée (niveau debug, sans spam). Le `Note Off` correspondant est ignoré aussi grâce à la table d'état. Pas de wrap, pas de modulo, pas de clamp.
3. **Mode Split / Dual du PSR avec octaves différentes par partie** : hors périmètre de la v1. Un seul `keyboardInputShift` global est appliqué. L'architecture doit cependant permettre d'ajouter plus tard une compensation par canal MIDI, et la limitation doit être documentée.
4. **Messages non-note** (CC, pitch bend, program change, aftertouch de canal) : aucun décalage. L'aftertouch polyphonique, qui porte un numéro de note, doit suivre la même transformation et la même table d'état que les notes ; le signaler s'il est présent dans le code.

## Phase 1 — Analyse de l'architecture uniquement

1. Inspecter le dépôt : routage ALSA / RTP-MIDI, entrées/sorties PSR, flux Synthesia, moteur de notes, sustain, anti-écho, configuration, UI/API, sortie LED DDP.
2. Tracer le diagramme **existant** puis le diagramme **cible** (flux A–D, espaces de notes) ; situer précisément chaque transformation.
3. **Anti-écho : analyser dans quel espace se fait la détection de boucle** (référence ou transformé). Si elle compare des numéros de note entre entrée et sortie, un décalage peut provoquer des échos non détectés (boucles) ou des faux positifs (notes légitimes supprimées). Proposer l'adaptation nécessaire. C'est le risque de régression prioritaire.
4. Concevoir les paramètres : unités, bornes, persistance, modification à chaud, via le mécanisme de configuration existant (fichier, API). Proposer comment les exposer dans l'interface de configuration si elle existe. Évaluer l'intérêt d'un affichage combiné (transpose + octave) sans perdre la distinction son / compensation.
5. Prévoir un composant pur de conversion de hauteur, sans effets de bord, et une normalisation unique du flux PSR partagée par C et D. Aucune double transposition.
6. Détailler le cycle de vie des notes selon la décision 1 : accords, notes répétées, `Note On` vélocité zéro, sustain CC64, panic/all-notes-off, changement de canal, déconnexion, redémarrage.
7. Préserver le temps réel : aucun appel HTTP par note, aucun blocage du routage MIDI par le DDP, pas de modification des 80 LED ni du mapping.
8. Analyser les risques de double transposition sonore (`psrTransposeAppliesToMidiIn`, Local Control, écho des notes clavier vers le PSR) et expliquer comment garder l'écoute cohérente.
9. Fournir un tableau d'impact : modules, réglages, tests unitaires et d'intégration, UI, documentation, migration rétrocompatible.
10. Rédiger `docs/global-transpose-octave-architecture.md` : schémas, équations, conventions de signes, exemples numériques, arbitrages, risques, scénarios de tests.
11. **S'arrêter et attendre ma validation explicite.**

## Phase 2 — Implémentation après validation

- S'intégrer au code existant, sans refonte gratuite.
- Tous les paramètres à `0` (et `psrTransposeAppliesToMidiIn = false`) : comportement strictement identique à l'actuel.
- Implémenter la sortie sonore (A), la normalisation clavier partagée (C, D), la table d'état des notes émises et l'adaptation de l'anti-écho.
- Préserver les notes LED Synthesia, le mapping 80 LED, les couleurs, la priorité, DDP/UDP `192.168.1.41:4048`, les ports.
- Tests automatisés : transformation pure, routage, cycle de vie des notes, anti-écho. Puis plan de validation manuelle sur matériel. Journalisation MIDI contrôlée et mode dry-run si le projet les prévoit déjà.
- Respecter les conventions de code ; commentaires en anglais, rares et utiles.

## Matrice de validation minimale

| Cas | Résultat attendu |
|---|---|
| Tous les réglages à zéro | Aucun changement par rapport au projet actuel |
| Scénario nominal : audio `-3`, PSR physique `-3`, touche `67` | PSR émet `64`, Synthesia et LED reçoivent `67` ; accompagnement et clavier sonnent en Mi |
| Synthesia `67`, audio `-3`, octave `0` | Son PSR `64`, LED Synthesia `67` |
| Synthesia `67`, audio `-3`, octave `-1` | Son PSR `52`, LED Synthesia `67` |
| Touche `67`, PSR physique `+3`, octave `0` | Reçu `70`, transmis `67` à Synthesia et aux LED clavier |
| Touche `67`, PSR physique `+3`, octave `+1` | Reçu `82`, transmis `67` |
| Touche `67`, PSR physique `-2`, octave `-1` | Reçu `53`, compensation `+14`, transmis `67` |
| Plusieurs notes et sources simultanées | Couleurs et priorités inchangées |
| Changement de réglage pendant une note tenue | `Note Off` au numéro réellement émis, aucune note bloquée |
| Note hors `[0,127]` après décalage | Ignorée et journalisée, aucun `Note Off` orphelin |
| Écho Synthesia avec transposition active | Écho toujours supprimé, aucune note légitime filtrée |
| Mode Split/Dual avec octaves différentes | Limitation documentée, aucun plantage ni note bloquée |
| Séquence rapide avec sustain et reconnexion | Pas de régression de latence, aucune boucle MIDI |

## Première réponse attendue de l'agent

**Ne pas écrire de code applicatif.** Produire uniquement `docs/global-transpose-octave-architecture.md`, puis donner dans le chat un résumé court contenant :

1. les flux actuels ;
2. l'architecture cible A–D et les formules ;
3. les modules impactés et le plan de tests ;
4. les risques ouverts et les choix nécessitant ma décision (en particulier l'anti-écho et la double transposition).

Puis attendre mon accord.
