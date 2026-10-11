# Mission : moteur MIDI/LED et intégration RTP-MIDI pour PianoLED

## Contexte validé

Le projet remplace le boîtier propriétaire PianoLED Plus tout en conservant le ruban LED existant. Un test Node.js `test-ddp.js` fonctionne déjà : il anime correctement **80 LED** en envoyant des trames DDP depuis Windows vers un contrôleur **GLEDOPTO ESP32 avec WLED 0.15.1**.

- GLEDOPTO : `192.168.1.41` (valeur configurable par environnement).
- DDP : UDP, port `4048`.
- **LED_COUNT = 80 strictement pendant toute la conception et le développement** ; indices autorisés `0..79`.
- Cadence de départ : `40 Hz` (configurable pour essais ultérieurs).
- Le Raspberry Pi 5 (2 Go) assurera à terme le traitement MIDI et le routage avec un PC Windows exécutant Synthesia + rtpMIDI.
- Conserver le contrôle des LED par GLEDOPTO/WLED ; ne pas piloter directement le ruban depuis les GPIO du Raspberry Pi.
- Deux sources de notes parallèles :
  - **Clavier physique** : LED **blanche** ; ses événements doivent aussi être transmis à Synthesia.
  - **Synthesia (MIDI OUT)** : LED **verte ou bleue** suivant une règle de canal/piste **configurable**, pas supposée connue.
- Si la même note est active dans les deux sources, la couleur **blanche est prioritaire**. À la relâche du clavier, restaurer le vert/bleu si Synthesia maintient la note.
- Respecter le fait que la configuration WLED annonce actuellement 798 LED et deux segments, mais que **seules les 80 premières LED ont été testées**. Ne pas modifier automatiquement la configuration WLED, les segments, le firmware ou le câblage.

## Objectif

Implémenter **les deux prochaines étapes**, avec code fonctionnel, tests, scripts de lancement et documentation :

1. **Étape 2 : moteur MIDI → état des LED → trames DDP**, testable sous Windows sans clavier ni Synthesia à l'aide d'événements MIDI simulés.
2. **Étape 3 : intégration MIDI réelle et RTP-MIDI bidirectionnel** sur Raspberry Pi 5, relié à Windows/Synthesia ; réutiliser exactement le même moteur de LED.

Ne pas se limiter à une proposition d'architecture ou du pseudocode : produire les fichiers, les tests et les commandes pour exécuter et valider chaque étape. Procéder par petites modifications contrôlées. Si un dépôt contient déjà du code, l'inspecter et réutiliser les briques existantes plutôt que réécrire inutilement.

## Contraintes techniques

- Node.js JavaScript (choisir ESM ou CommonJS de manière cohérente avec le dépôt ; expliquer brièvement le choix).
- Dépendances limitées et justifiées. Utiliser `node:dgram` pour DDP ; éviter toute dépendance réseau inutile.
- Configuration par variables d'environnement ou fichier de configuration versionnable sans secrets ; valeurs par défaut documentées.
- Séparer le traitement **MIDI**, l'**état des notes**, la **projection note→LED**, l'**émission DDP** et les **adaptateurs d'entrée/sortie MIDI**.
- Ne jamais mélanger les événements Synthesia OUT et clavier IN en une même source logique.
- Ne pas utiliser les événements audio AudioReactive de WLED pour la correspondance des touches ; piloter directement les pixels.
- Tous les commentaires dans le code doivent être en anglais et rester utiles et peu nombreux.

## Étape 2 — Moteur MIDI/LED

### Modèle de données

Créer des événements normalisés au minimum :

```js
{
  source: 'keyboard' | 'synthesia',
  type: 'noteon' | 'noteoff' | 'cc',
  note: 60,
  velocity: 100,
  channel: 0,
  timestamp: 0
}
```

Le `channel` doit avoir une convention explicite (0..15 côté code, ou 1..16 côté utilisateur). Normaliser les messages MIDI : un `Note On` de vélocité 0 vaut `Note Off`. Inclure à minima la gestion des messages `All Notes Off` / `All Sound Off` pour éviter les LED bloquées. Distinguer état physique des touches et état du son en cas de pédale de sustain ; rendre la stratégie de sustain explicite et testable.

### Gestion des états

- Stocker séparément les notes actives du clavier et celles de Synthesia, en distinguant les canaux si pertinent.
- Autoriser la polyphonie et plusieurs notes simultanées.
- Une note relâchée sur une source ne doit pas effacer son état dans l'autre.
- Appliquer la priorité d'affichage : `keyboard -> white`, sinon `synthesia -> green/blue`, sinon `off`.
- La correspondance couleur Synthesia doit être configurable par canal et disposer d'une valeur par défaut documentée. Ne **pas** présumer de la main gauche/droite sans relevé des messages réels.
- Prévoir `panic` / remise à zéro explicite des états en cas d'arrêt et de déconnexion ; éviter les LEDs coincées. Définir le comportement en cas de déconnexion réseau et les limites de détection UDP.
- Gérer les événements répétés et les cas d'ordre particulier ; documenter la politique si plusieurs producteurs transmettent la même note sur le même canal.

### Correspondance notes ↔ pixels

- **Fixer la taille du buffer à 80 pixels RGB**, soit 240 octets de données utiles.
- `MIDI_BASE_NOTE` et la politique de correspondance doivent être configurables ; **ne pas supposer que la note 60 correspond à une LED précise sans calibration**.
- Proposer une correspondance linéaire par défaut pour le prototype et prendre en charge une table explicite personnalisée `midiNote -> ledIndex`.
- Une note hors correspondance doit être ignorée pour l'éclairage (avec éventuellement journalisation de debug), mais son routage MIDI vers Synthesia doit continuer.
- Valider strictement tout indice dans `[0,79]`.

### Émetteur DDP

- Reprendre comme base le code DDP du test fonctionnel (`test-ddp.js`) s'il est présent dans le dépôt.
- Envoyer un **frame buffer RGB complet** dans un paquet DDP unicast sur UDP `4048`, sans requête HTTP par note.
- Construire l'en-tête DDP conformément à l'implémentation testée ; maintenir un numéro de séquence ; vérifier la longueur (240 octets RGB pour 80 LED).
- Déclencher une émission rapide sur changement d'état, en regroupant les changements très rapprochés ; pouvoir réémettre l'état courant à une fréquence configurable (40 Hz initialement) pendant l'activité. Éviter les envois concurrents non ordonnés et les temporisations par note susceptibles de créer de la gigue.
- Fournir une stratégie d'arrêt : trame noire et libération du socket. Ne pas prétendre garantir l'extinction si réseau ou contrôleur injoignable.
- Fournir un mode `dry-run` qui n'émet aucun paquet réseau et affiche les états/compteurs.
- Ne pas imposer 798 pixels parce que WLED annonce `count:798` : utiliser 80 pixels pour cette phase.

### Simulation et validation étape 2

Créer une CLI ou des scripts capables de :

1. Allumer/éteindre individuellement chaque source (`noteOn`/`noteOff`).
2. Simuler gamme, accords polyphoniques et séquences rapides.
3. Tester un chevauchement sur une même note : vert/bleu Synthesia, puis blanc clavier, puis retour à la couleur Synthesia, puis extinction.
4. Vérifier des notes hors plage, vélocité nulle, répétitions et remise à zéro.
5. Afficher des métriques : nombre d'événements traités, trames envoyées, fréquence réelle d'émission, intervalles entre trames et distribution des délais d'attente **côté émetteur**.

Écrire des tests unitaires déterministes sur la fusion des états, les priorités de couleur, le mapping et l'encodage DDP. Les mesures côté Node.js **ne mesurent pas la latence optique réelle** ; distinguer clairement les deux.

**Critère de validation :** sur les 80 LED déjà fonctionnelles, les notes simulées donnent les bonnes couleurs, la polyphonie fonctionne, les chevauchements sont corrects, et aucune extinction par une source n'efface une note encore active de l'autre.

## Étape 3 — Intégration MIDI physique et RTP-MIDI

### Topologie cible

```text
Clavier MIDI ── MIDI IN (USB-MIDI ou interface DIN adaptée) ──> Raspberry Pi 5
                                                              │
                                                              ├──> moteur d'état clavier ──> DDP ──> GLEDOPTO ──> 80 LED
                                                              │
                                                              └──> RTP-MIDI OUT ──> PC Windows / rtpMIDI / Synthesia MIDI IN

PC Windows / Synthesia MIDI OUT ──> rtpMIDI ──> Raspberry Pi 5
                                                │
                                                └──> moteur d'état Synthesia ──> même état LED / DDP
```

Identifier comment le clavier physique est raccordé (USB-MIDI ou MIDI DIN 5 broches) **avant d'arrêter le choix du périphérique matériel**. Si cette information manque, implémenter une interface d'adaptation et documenter les deux options ; ne pas inventer de port ou de matériel existant.

### RTP-MIDI et ALSA

- Sur Raspberry Pi OS, privilégier une solution maintenue, compatible avec ALSA et AppleMIDI/RTP-MIDI, par exemple `rtpmidid` **après vérification de sa disponibilité et de sa compatibilité** avec la distribution retenue.
- Inspecter les ports ALSA disponibles (`aconnect -l`, `amidi -l` selon les cas), afficher les interfaces MIDI détectées et permettre leur sélection par configuration.
- Mettre en place deux chemins logiques clairement identifiés :
  1. **Clavier physique → Synthesia** (événements réels joués).
  2. **Synthesia → moteur LED** (événements d'accompagnement/visualisation).
- Éviter les boucles de retour MIDI : ne jamais réinjecter sans condition les événements de Synthesia dans son entrée ou renvoyer au clavier les notes destinées uniquement aux LED.
- Préserver les données MIDI importantes (note, vélocité, canal, `noteoff`, CC/pédale pertinents) ; ne pas transformer les notes par erreur.
- Prendre en charge reconnexion, changements de port et redémarrage ; en cas de perte de flux, appliquer une politique documentée pour nettoyer les notes actives, sans effacer arbitrairement l'autre source.
- Fournir les instructions Windows : configuration rtpMIDI, session réseau, association à Synthesia `MIDI IN` / `MIDI OUT`, avec des intitulés de ports effectivement observés et non inventés.
- Utiliser de préférence Ethernet pour le Raspberry Pi si disponible ; Wi-Fi fonctionnel acceptable pour les tests. Mesurer la gigue de bout en bout avec une méthode explicitement définie.

### Observabilité

- Ajouter un mode diagnostic affichant pour chaque message MIDI : sens, origine, type, canal, note et horodatage monotone si possible.
- Afficher l'état des 80 LED et les données de connectivité RTP-MIDI/DDP.
- Prévoir un outil de capture court des messages sortants de Synthesia afin de déterminer **réellement** comment différencier vert et bleu (canaux, pistes ou autre convention). Ne pas coder cette règle à partir d'une supposition.
- Ajouter un script de test qui envoie des notes jouées depuis le clavier vers Synthesia et vérifie en parallèle l'éclairage blanc.

### Service et lancement

- Fournir un fichier `.env.example`, des scripts npm, un README de démarrage Windows et Raspberry Pi et, si pertinent, une unité `systemd` pour lancement automatique et redémarrage contrôlé.
- Ne pas réaliser d'installations système irréversibles ou modifier la configuration rtpMIDI/WLED existante sans les documenter et sans validation explicite.
- Distinguer dépendances applicatives, dépendances système ALSA/RTP-MIDI, configuration locale du réseau et paramètres non encore connus.

**Critères de validation :**

1. Toucher une touche du clavier produit une LED blanche et un événement d'entrée détecté par Synthesia.
2. Synthesia envoie des notes RTP-MIDI qui déclenchent des LED vertes ou bleues, selon la règle observée et configurée.
3. Les deux flux fonctionnent simultanément, sans feedback MIDI et sans perte de priorité d'affichage.
4. Les séquences polyphoniques rapides sont testées ; les métriques de délais sont fournies honnêtement, sans déduire une latence optique d'une simple mesure de socket.
5. Déconnecter/reconnecter un flux ne laisse pas les LED indéfiniment actives et n'efface pas le flux qui reste opérationnel.

## Livrables attendus

- Arborescence de projet claire avec modules `midi`, `state`, `mapping`, `ddp`, `adapters`, `simulation`, `config` (adapter les noms au dépôt existant).
- Code réellement exécutable sur Windows pour l'étape 2 et sur Raspberry Pi OS pour l'étape 3.
- Tests unitaires automatisés et commandes exactes pour les lancer.
- Scripts de démonstration : une seule note, accord, chevauchement blanc/vert/bleu, séquence rapide, extinction/panic.
- Documentation des réglages Windows rtpMIDI / Synthesia / Raspberry Pi / WLED.
- Journal de validation par étape : fonctionnalités testées, résultats, limites et éléments encore à confirmer.

## Ordre de travail imposé

1. Examiner les fichiers existants et récupérer le test DDP validé sans le casser.
2. Implémenter **entièrement l'étape 2** et ses tests.
3. Faire valider le test réel des 80 LED avant d'activer les périphériques MIDI.
4. Implémenter les adaptateurs MIDI et la configuration RTP-MIDI de l'étape 3.
5. Tester chaque sens séparément avant les deux flux combinés.
6. Réaliser les tests de performance, documenter précisément la latence et la gigue mesurées et les limites.

Ne pas changer `LED_COUNT = 80` et ne pas déduire une topologie physique différente des seules données `leds.count = 798` de l'API WLED.
