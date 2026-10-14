'use strict';

// Describes every .env variable for the control UI. Validation itself stays in src/config (loadConfig).
// type: int | number | bool | enum | color | text | port-in | port-out | channels | colorname
const GROUPS = [
  { id: 'ddp', label: 'Réseau & DDP', icon: 'wifi', hint: 'Liaison vers le contrôleur WLED / GLEDOPTO.' },
  { id: 'perf', label: 'Cadence & latence', icon: 'gauge', hint: 'Fréquence d’envoi et regroupement des trames.' },
  { id: 'colors', label: 'Couleurs', icon: 'palette', hint: 'Luminosité globale et couleurs des sources.' },
  { id: 'mapping', label: 'Mapping notes → LEDs', icon: 'map', hint: 'Correspondance entre notes MIDI et index de LED.' },
  { id: 'midi', label: 'Ports MIDI', icon: 'plug', hint: 'Clavier, Synthesia et routage.' },
  { id: 'pitch', label: 'Transposition & octave', icon: 'music', hint: 'Appliqué à chaud. Synthesia ne doit appliquer aucun décalage de son côté : tout est géré ici et par le PSR. Les LED et la validation Synthesia restent dans la tonalité des morceaux.' },
  { id: 'misc', label: 'Divers', icon: 'cog', hint: 'Pédale de sustain, logs.' },
];

const FIELDS = [
  { key: 'WLED_HOST', group: 'ddp', type: 'text', label: 'Adresse WLED', help: 'IP ou nom d’hôte du contrôleur.', def: '192.168.1.41', placeholder: '192.168.1.41' },
  { key: 'DDP_PORT', group: 'ddp', type: 'int', label: 'Port DDP', help: 'Port UDP du protocole DDP.', def: '4048', min: 1, max: 65535 },
  { key: 'DRY_RUN', group: 'ddp', type: 'bool', label: 'Mode simulation (dry-run)', help: 'Aucun paquet réseau : seulement logs et compteurs.', def: '0' },
  { key: 'BLACK_FRAMES_ON_STOP', group: 'ddp', type: 'int', label: 'Trames noires à l’arrêt', help: 'Nombre de trames noires envoyées pour éteindre la bande.', def: '3', min: 1, max: 20 },

  { key: 'FPS', group: 'perf', type: 'number', label: 'Fréquence keepalive', unit: 'Hz', help: 'Cadence de renvoi de la trame courante.', def: '40', min: 1, max: 120, step: 1, slider: true },
  { key: 'KEEPALIVE', group: 'perf', type: 'enum', label: 'Keepalive', help: 'always : renvoie en continu (garde WLED en temps réel) · active : seulement si des LEDs sont allumées · off : jamais.', def: 'always', options: ['always', 'active', 'off'] },
  { key: 'IDLE_KEEPALIVE_MS', group: 'perf', type: 'int', label: 'Keepalive au repos', unit: 'ms', help: 'Délai après changement en mode « active ».', def: '3000', min: 0, max: 600000 },
  { key: 'COALESCE_MS', group: 'perf', type: 'number', label: 'Regroupement d’événements', unit: 'ms', help: '0 = au prochain tour de boucle ; >0 = attend ce délai.', def: '0', min: 0, max: 50 },
  { key: 'MIN_FRAME_GAP_MS', group: 'perf', type: 'number', label: 'Écart min. entre trames', unit: 'ms', help: 'Plafonne le débit en rafale (1000 / valeur = fps max).', def: '5', min: 0, max: 100 },

  { key: 'BRIGHTNESS', group: 'colors', type: 'number', label: 'Luminosité globale', help: 'Échelle 0..1 appliquée à toutes les couleurs (budget d’alimentation).', def: '0.25', min: 0, max: 1, step: 0.01, slider: true },
  { key: 'COLOR_KEYBOARD', group: 'colors', type: 'color', label: 'Clavier (vous)', help: 'Notes jouées sur le clavier.', def: '#FF4D9D' },
  { key: 'COLOR_SYNTHESIA', group: 'colors', type: 'color', label: 'Synthesia', help: 'Notes demandées par Synthesia.', def: '#00CFF5' },
  { key: 'COLOR_SYNTHESIA_BLACK', group: 'colors', type: 'color', label: 'Synthesia (notes noires)', help: 'Touches noires demandées par Synthesia.', def: '#8A2BFF' },
  { key: 'COLOR_OVERLAP', group: 'colors', type: 'color', label: 'Recouvrement', help: 'Même note allumée par les deux sources.', def: '#00FF00' },
  { key: 'OVERLAP_BOOST', group: 'colors', type: 'number', label: 'Luminosité du recouvrement', unit: '×', help: 'Multiplicateur de luminosité appliqué à la couleur de recouvrement (2 = deux fois plus lumineux).', def: '2', min: 0, max: 10, step: 0.1, slider: true },
  { key: 'COLOR_GREEN', group: 'colors', type: 'color', label: 'Couleur « green »', help: 'Palette nommée utilisable par canal.', def: '0,255,0' },
  { key: 'COLOR_BLUE', group: 'colors', type: 'color', label: 'Couleur « blue »', help: 'Palette nommée utilisable par canal.', def: '0,0,255' },
  { key: 'SYNTH_DEFAULT_COLOR', group: 'colors', type: 'enum', label: 'Couleur Synthesia par défaut', help: 'Utilisée pour les canaux sans règle.', def: 'synthesia', options: ['synthesia', 'green', 'blue', 'white', 'red', 'cyan', 'yellow'] },
  { key: 'SYNTH_CHANNEL_COLORS', group: 'colors', type: 'text', label: 'Couleur par canal Synthesia', help: 'Format canal:couleur (canaux 1..16), ex. 1:green,2:blue.', def: '', placeholder: '1:green,2:blue' },

  { key: 'MAPPING_MODE', group: 'mapping', type: 'enum', label: 'Mode', help: 'linear : formule · table : fichier JSON explicite.', def: 'linear', options: ['linear', 'table'] },
  { key: 'MIDI_BASE_NOTE', group: 'mapping', type: 'int', label: 'Note MIDI de base', help: 'Note associée à la LED d’origine (21 = A0).', def: '21', min: 0, max: 127, showIf: { MAPPING_MODE: 'linear' } },
  { key: 'LED_OFFSET', group: 'mapping', type: 'int', label: 'Décalage LED', help: 'led = offset + (note − base).', def: '0', min: -127, max: 119, showIf: { MAPPING_MODE: 'linear' } },
  { key: 'LED_REVERSE', group: 'mapping', type: 'bool', label: 'Inverser le sens', help: 'Miroir de la bande.', def: '0', showIf: { MAPPING_MODE: 'linear' } },
  // Fixed path (not editable in the UI): the table is edited in the dedicated note-map editor.
  { key: 'NOTE_MAP_FILE', group: 'mapping', type: 'text', hidden: true, label: 'Fichier de table', def: 'config/note-map.json' },

  { key: 'KEYBOARD_IN_PORT', group: 'midi', type: 'port-in', label: 'Entrée clavier', help: 'Sous-chaîne du nom du port (insensible à la casse).', def: '' },
  { key: 'SYNTHESIA_IN_PORT', group: 'midi', type: 'port-in', label: 'Entrée Synthesia', help: 'Port d’où Synthesia envoie ses notes.', def: '' },
  { key: 'SYNTHESIA_OUT_PORT', group: 'midi', type: 'port-out', label: 'Sortie vers Synthesia', help: 'Où le clavier est retransmis.', def: '' },
  { key: 'KEYBOARD_OUT_PORT', group: 'midi', type: 'port-out', label: 'Sortie clavier', help: 'Vide = identique à l’entrée clavier.', def: '' },
  { key: 'FORWARD_KEYBOARD', group: 'midi', type: 'bool', label: 'Retransmettre clavier → Synthesia', help: 'Désactiver si le routage est fait via aconnect.', def: '1' },
  { key: 'FORWARD_SYNTHESIA', group: 'midi', type: 'bool', label: 'Jouer Synthesia sur le clavier', help: 'Utilise le moteur sonore du clavier.', def: '0' },
  { key: 'PORT_POLL_MS', group: 'midi', type: 'int', label: 'Scrutation des ports', unit: 'ms', help: 'Reconnexion automatique.', def: '2000', min: 200, max: 60000 },
  { key: 'ECHO_GUARD_MS', group: 'midi', type: 'int', label: 'Garde anti-écho', unit: 'ms', help: '>0 : ignore une note Synthesia identique à une note clavier récente.', def: '0', min: 0, max: 1000 },
  { key: 'SYNTH_STALE_MS', group: 'midi', type: 'int', label: 'Péremption Synthesia', unit: 'ms', help: '>0 : éteint les LEDs Synthesia sans message depuis N ms.', def: '0', min: 0, max: 3600000 },

  { key: 'AUDIO_TRANSPOSE_SEMITONES', group: 'pitch', hot: true, type: 'int', label: 'Son : transposition', unit: 'demi-tons', help: 'Synthesia → PSR. Ex. −3 : un morceau en Sol sonne en Mi. Les LED ne changent pas.', def: '0', min: -12, max: 12 },
  { key: 'AUDIO_OCTAVE_SHIFT', group: 'pitch', hot: true, type: 'int', label: 'Son : décalage d’octave', unit: 'octaves', help: 'Synthesia → PSR, s’ajoute à la transposition (12 demi-tons par octave).', def: '0', min: -3, max: 3 },
  { key: 'KEYBOARD_PHYSICAL_TRANSPOSE_SEMITONES', group: 'pitch', hot: true, type: 'int', label: 'Compensation clavier : transposition', unit: 'demi-tons', help: 'Transposition réellement appliquée par le PSR sur son MIDI OUT. Les notes sont ramenées à la touche physique avant Synthesia et les LED.', def: '0', min: -12, max: 12 },
  { key: 'KEYBOARD_PHYSICAL_OCTAVE_SHIFT', group: 'pitch', hot: true, type: 'int', label: 'Compensation clavier : octave', unit: 'octaves', help: 'Décalage d’octave réellement appliqué par le PSR sur son MIDI OUT. Un seul décalage global (Split/Dual avec octaves différentes non géré).', def: '0', min: -3, max: 3 },

  { key: 'SUSTAIN_MODE', group: 'misc', type: 'enum', label: 'Pédale de sustain', help: 'keys : suit les touches · sound : reste allumé tant que la pédale tient.', def: 'keys', options: ['keys', 'sound'] },
  { key: 'LOG_LEVEL', group: 'misc', type: 'enum', label: 'Niveau de logs', help: '', def: 'info', options: ['error', 'warn', 'info', 'debug'] },
];

const KEYS = FIELDS.map((f) => f.key);

const NOTE_MAP_FILE = 'config/note-map.json';

module.exports = { GROUPS, FIELDS, KEYS, NOTE_MAP_FILE };
