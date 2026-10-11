# Windows — rtpMIDI et Synthesia

Les intitulés ci-dessous sont à **relever sur votre machine** ; ne recopiez pas de noms supposés.
Port déjà observé sur ce PC (`npm run ports`, 2026-10-11) : entrée et sortie **`APPDEV10`** — vraisemblablement une session rtpMIDI existante (à confirmer dans le panneau rtpMIDI). La configuration rtpMIDI existante n'a pas été modifiée.

## Étape 2 (aucun réglage MIDI requis)

Le simulateur n'utilise que le réseau vers le GLEDOPTO : `npm run demo:all`.

## Étape 3

### rtpMIDI (Tobias Erichsen)

1. Ouvrir rtpMIDI. Dans **My Sessions**, utiliser la session existante (ou en créer une avec `+`) et la cocher **Enabled**. Le nom de session est le nom du port MIDI vu par Windows et Synthesia.
2. Dans **Directory**, le Raspberry Pi (rtpmidid) doit apparaître via Bonjour. Le sélectionner puis **Connect**. S'il n'apparaît pas : ajouter manuellement l'adresse IP du Pi et le port 5004 dans la liste des pairs.
3. La colonne **Participants** de la session doit afficher le Pi avec une latence ; noter ces valeurs dans [VALIDATION.md](VALIDATION.md).
4. Le pare-feu Windows doit autoriser rtpMIDI (UDP 5004/5005 et mDNS).

### Synthesia

Dans **Settings → Music Devices** (intitulés à vérifier selon la version) :

- **Input** : activer le port de la session rtpMIDI → reçoit les notes du clavier physique relayées par le Pi.
- **Output** : activer le même port de session → Synthesia envoie au Pi les notes qui pilotent les LED vert/bleu.
- Les options de la sortie (envoi du son et/ou des « key lights », séparation par mains/canaux) déterminent les canaux utilisés. **Noter les options choisies**, puis lancer `npm run capture -- --seconds 60` sur le Pi pendant la lecture d'un morceau à deux mains pour relever les canaux réels avant de fixer `SYNTH_CHANNEL_COLORS`.
- Si Synthesia renvoie sur sa sortie les notes jouées au clavier (écho visible en `npm run diag` : une ligne `IN synthesia` identique juste après `IN keyboard`), désactiver cet écho dans Synthesia ou régler `ECHO_GUARD_MS=30` sur le Pi.
- Désactiver toute autre entrée/sortie inutile (par ex. « Microsoft GS Wavetable Synth » si le son vient d'ailleurs) pour éviter des doublons.

### Mesure de RTT RTP-MIDI

1. Fermer Synthesia (le port ne doit pas être utilisé par un autre programme pendant la mesure).
2. Windows : `npm install` puis `npm run echo:windows -- --list`, puis `npm run echo:windows -- --in "<session>" --out "<session>"`.
3. Pi : `npm run rtt -- --count 500 --interval 20`.
Seules les notes du canal 16 sont renvoyées par l'outil d'écho.
