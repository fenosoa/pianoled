# WLED / GLEDOPTO — notes de configuration

Aucun réglage WLED, segment, firmware ou câblage n'est modifié par ce projet.

## État connu

- GLEDOPTO ESP32, WLED 0.15.1, IP `192.168.1.41` (`WLED_HOST`).
- WLED annonce `leds.count = 798` et deux segments. **Seules les 80 premières LED ont été testées** ; ce projet envoie toujours 80 pixels (offset DDP 0, 240 octets). Les LED 80..797 ne reçoivent aucune donnée de ce projet et conservent l'état décidé par WLED.
- On ne déduit aucune topologie physique de la valeur 798.

## Comportement DDP à connaître

- WLED passe en mode « realtime » à la réception de DDP et revient à son effet/préréglage normal après un délai sans paquet (réglage « Realtime timeout » de WLED, page *Sync Interfaces*). Avec `KEEPALIVE=always` (défaut), la trame courante est renvoyée à 40 Hz : WLED reste en mode realtime tant que le service tourne. Avec `active`/`off`, WLED peut reprendre son propre effet quand le piano est inactif.
- Après l'arrêt du service, des trames noires sont envoyées ; ensuite WLED reprend son comportement normal à l'expiration du délai realtime (ce qui peut rallumer le ruban selon son préréglage).
- L'option WLED « Use main segment only » / les réglages de segments peuvent influer sur la zone affectée par le realtime : à observer, non modifié ici.
- La luminosité globale WLED s'applique en plus de `BRIGHTNESS` selon la version/les options realtime : régler d'abord `BRIGHTNESS` côté application.

## Alimentation

80 LED en blanc pleine intensité consomment nettement plus que des LED vertes ou bleues ; `BRIGHTNESS=0.25` par défaut. Vérifier l'alimentation existante avant d'augmenter.
