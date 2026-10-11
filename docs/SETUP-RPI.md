# Raspberry Pi 5 (2 Go) — installation étape 3

Rien ci-dessous n'est exécuté automatiquement. Chaque commande système est à lancer manuellement, après relecture.

## 0. Informations encore inconnues (à relever avant d'arrêter le matériel)

| Élément | Comment le déterminer | Valeur |
|---|---|---|
| Raccordement du clavier | prise USB du clavier | ✅ **USB** (confirmé 2026-10-11) : option 1 ci-dessous |
| Nom ALSA du clavier | `npm run ports` / `aconnect -l` une fois branché | _à relever_ |
| Nom des ports rtpmidid | `aconnect -l` après connexion de la session Windows | _à relever_ |
| Règle vert/bleu de Synthesia | `npm run capture` | _à relever_ |
| Lien réseau du Pi | Ethernet (préféré) ou Wi-Fi | _à confirmer_ |

### Options de raccordement du clavier

1. **USB-MIDI — option retenue** (clavier avec port USB « to host ») : câble USB direct vers le Pi. Pilote `snd-usb-audio` inclus dans Raspberry Pi OS ; le clavier apparaît comme client ALSA séquenceur. Aucun matériel supplémentaire.
2. **MIDI DIN 5 broches** : nécessite une interface **USB-MIDI class compliant** (DIN → USB) côté Pi, ou une interface UART MIDI (opto-coupleur, norme MIDI) sur le GPIO série — cette seconde option demande du câblage électronique et la configuration de l'UART ; elle n'est pas couverte ici. L'interface USB est recommandée.

Dans les deux cas, l'application ne voit qu'un port ALSA, sélectionné par `KEYBOARD_IN_PORT` : le code ne dépend pas du type de raccordement.

## 1. Dépendances système (à distinguer des dépendances applicatives)

```bash
# Node.js >= 20 (vérifier : node -v). Raspberry Pi OS Bookworm fournit Node 18 : installer une version LTS
# depuis le dépôt NodeSource ou via nvm, selon votre politique.
sudo apt update
sudo apt install -y alsa-utils          # aconnect, amidi, aseqdump (diagnostic)
sudo apt install -y libasound2-dev build-essential   # seulement si @julusian/midi doit être compilé
```

### rtpmidid (RTP-MIDI / AppleMIDI ↔ ALSA)

`rtpmidid` (projet davidmoreno/rtpmidid) expose les sessions RTP-MIDI comme ports du séquenceur ALSA et s'annonce via mDNS (Avahi).
**Vérifier la disponibilité et la compatibilité avant installation** :

```bash
apt-cache policy rtpmidid               # 1) paquet disponible dans les dépôts de la distribution ?
uname -m; cat /etc/os-release           # architecture (aarch64) et version (Bookworm, ...)
```

- Si le paquet existe : `sudo apt install rtpmidid`.
- Sinon : paquet `.deb` arm64 publié dans les *releases* GitHub du projet, s'il correspond à la version de Debian ; sinon compilation depuis les sources (voir le README du projet).
- Service : `systemctl status rtpmidid` ; journal : `journalctl -u rtpmidid -f`.
- La configuration par défaut de rtpmidid n'est pas modifiée par ce projet. Si vous la modifiez (nom annoncé, port UDP 5004/5005), consignez-le dans [VALIDATION.md](VALIDATION.md).

Pare-feu : RTP-MIDI utilise deux ports UDP consécutifs (5004/5005 par défaut) et mDNS (UDP 5353).

## 2. Application

```bash
git clone <dépôt> ~/ownpianoled   # ou copie du dossier
cd ~/ownpianoled
npm install                        # dépendance applicative : @julusian/midi
cp .env.example .env
npm test
npm run demo:all:dry
npm run demo:overlap               # vérification DDP depuis le Pi vers 192.168.1.41
```

## 3. Ports MIDI

```bash
npm run ports        # liste RtMidi + aconnect -l + amidi -l
```

Copier dans `.env` une **sous-chaîne distinctive** du nom observé (insensible à la casse ; éviter les numéros `128:0` qui changent au redémarrage) :

```ini
KEYBOARD_IN_PORT=<nom observé du clavier>
SYNTHESIA_IN_PORT=<nom observé du port rtpmidid de la session Windows>
SYNTHESIA_OUT_PORT=<même port rtpmidid, côté sortie>
```

`npm run ports` affiche ensuite la correspondance trouvée pour chaque variable (`NOT FOUND` sinon).

### Routage clavier → Synthesia : deux options exclusives

- **A. Par l'application** (défaut, `FORWARD_KEYBOARD=1`) : le service relit le clavier, transmet chaque message de canal sans le modifier vers `SYNTHESIA_OUT_PORT` (avant le traitement LED), et compte les pertes.
- **B. Par ALSA** (`FORWARD_KEYBOARD=0`) : `aconnect '<clavier>' '<port rtpmidid>'` (non persistant au redémarrage). Le service ne fait alors que lire.

Ne pas activer A et B simultanément : Synthesia recevrait chaque note en double. Vérifier avec `aconnect -l` qu'aucune connexion clavier → rtpmidid n'existe en mode A.

## 4. Tests par sens, puis combinés

1. LED seules : `npm run demo:all` depuis le Pi.
2. Clavier → LED : `KEYBOARD_IN_PORT` seul, `npm run diag`, jouer : lignes `IN keyboard`, LED blanches.
3. Clavier → Synthesia : `npm run kbd-test` (notes injectées), puis `npm run kbd-test -- --mode live --seconds 30`.
4. Synthesia → LED : `npm run capture -- --seconds 60` en jouant un morceau, choisir `SYNTH_CHANNEL_COLORS`, puis `npm run diag`.
5. Les deux flux : `npm run diag`, jouer en même temps que Synthesia ; vérifier `fwdDrop=0`, priorité blanche.
6. Déconnexion : débrancher le clavier pendant une note tenue → ses LED s'éteignent, les LED Synthesia restent ; rebrancher → `connected` dans le journal. Couper la session rtpMIDI côté Windows → si le port ALSA disparaît, LED Synthesia effacées ; sinon tester `SYNTH_STALE_MS`.

## 5. Service systemd

```bash
sudo usermod -aG audio $USER                  # accès ALSA (si nécessaire)
sudo cp deploy/pianoled.service /etc/systemd/system/   # adapter User/WorkingDirectory/chemin node
sudo systemctl daemon-reload
sudo systemctl enable --now pianoled
journalctl -u pianoled -f
sudo systemctl kill -s USR1 pianoled          # panic toutes sources
```

L'unité démarre après `rtpmidid.service` si elle existe ; si un port n'est pas encore présent, le service attend et se connecte dès son apparition (sondage).
