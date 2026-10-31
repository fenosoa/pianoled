"""Génère le profil Stream Deck « Karaoke Mixer » (fichier .streamDeckProfile) et ses icônes PNG.

Usage : python tools/streamdeck/make_profile.py [hôte:port]   (défaut localhost:5180)
Sortie : tools/streamdeck/KaraokeMixer.streamDeckProfile + tools/streamdeck/icons/*.png

Chaque touche utilise l'action native « Website » en mode arrière-plan (GET, sans ouvrir le navigateur)
vers /control/... du lecteur d'accords (voir vite.config.js).
"""
import json
import sys
import uuid
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost:5180"
OUT = Path(__file__).parent
ICONS = OUT / "icons"
SIZE = 144
FONT = "C:/Windows/Fonts/segoeuib.ttf"
SYM = "C:/Windows/Fonts/seguisym.ttf"

VOICE, PIANO, GUITAR, MODE, TRANSPORT = "#e0457b", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6"

# (colonne, ligne, id, chemin, libellé, couleur, glyphe)
KEYS = [
    (0, 0, "4_voix_plus", "mixer/4", "VOIX", VOICE, "+"),
    (1, 0, "6_piano_plus", "mixer/6", "PIANO", PIANO, "+"),
    (2, 0, "8_guitare_plus", "mixer/8", "GUITARE", GUITAR, "+"),
    (0, 1, "5_voix_moins", "mixer/5", "VOIX", VOICE, "−"),
    (1, 1, "7_piano_moins", "mixer/7", "PIANO", PIANO, "−"),
    (2, 1, "9_guitare_moins", "mixer/9", "GUITARE", GUITAR, "−"),
    (0, 2, "1_karaoke", "mixer/1", "KARAOKÉ", MODE, "🎤"),
    (1, 2, "2_mute_voix", "mixer/2", "MUTE VOIX", VOICE, "🔇"),
    (2, 2, "3_performance", "mixer/3", "JE JOUE", MODE, "🎹"),
    (3, 2, "0_reset", "mixer/0", "RESET", "#64748b", "↺"),
    (3, 0, "play_pause", "play-pause", "PLAY/PAUSE", TRANSPORT, "⏯"),
    (4, 0, "next", "next", "SUIVANT", TRANSPORT, "⏭"),
    (3, 1, "restart", "restart", "DÉBUT", TRANSPORT, "⏮"),
    (4, 1, "previous", "previous", "PRÉCÉDENT", TRANSPORT, "◀◀"),
]


def font(path, size):
    return ImageFont.truetype(path, size)


def fit(draw, text, path, size, width):
    f = font(path, size)
    while draw.textlength(text, font=f) > width and size > 10:
        size -= 2
        f = font(path, size)
    return f


def icon(color, label, glyph):
    img = Image.new("RGB", (SIZE, SIZE), "#111827")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((4, 4, SIZE - 5, SIZE - 5), 18, fill=color)
    if glyph in "+−":
        d.text((SIZE / 2, 58), glyph, font=font(FONT, 84), fill="white", anchor="mm")
    else:
        d.text((SIZE / 2, 58), glyph, font=fit(d, glyph, SYM, 64, 100), fill="white", anchor="mm")
    d.text((SIZE / 2, 116), label, font=fit(d, label, FONT, 24, 124), fill="white", anchor="mm")
    return img


def action(key_id, path):
    state = {"FontFamily": "", "FontSize": "12", "FontStyle": "", "FontUnderline": False,
             "Image": f"Images/{key_id}.png", "ShowTitle": False, "Title": "", "TitleAlignment": "bottom",
             "TitleColor": "#ffffff"}
    return {
        "ActionID": str(uuid.uuid4()),
        "LinkedTitle": True,
        "Name": "Site web",
        "Plugin": {"Name": "Site web", "UUID": "com.elgato.streamdeck.system.website", "Version": "1.0"},
        "Settings": {"openInBrowser": False, "path": f"http://{HOST}/control/{path}"},
        "State": 0,
        "States": [state],
        "UUID": "com.elgato.streamdeck.system.website",
    }


def main():
    ICONS.mkdir(exist_ok=True)
    page_id = str(uuid.uuid4())
    profile_id = str(uuid.uuid4()).upper()
    actions = {}
    images = {}
    for col, row, key_id, path, label, color, glyph in KEYS:
        img = icon(color, label, glyph)
        img.save(ICONS / f"{key_id}.png")
        images[key_id] = ICONS / f"{key_id}.png"
        actions[f"{col},{row}"] = action(key_id, path)

    page = {"Controllers": [{"Actions": actions, "Type": "Keypad"}], "Icon": "", "Name": ""}
    profile = {
        "Device": {"Model": "20GBA9901", "UUID": ""},
        "Name": "Karaoke Mixer",
        "Pages": {"Current": page_id, "Pages": [page_id]},
        "Version": "3.0",
    }
    package = {"AppVersion": "6.5.0.20000", "DeviceModel": "20GBA9901", "DeviceSettings": None,
               "FormatVersion": 1, "OSType": "windows", "RequiredPlugins": [], "Version": "1.0"}

    target = OUT / "KaraokeMixer.streamDeckProfile"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("package.json", json.dumps(package, indent=2))
        z.writestr(f"Profiles/{profile_id}.sdProfile/manifest.json", json.dumps(profile, indent=2))
        # V3 : les pages vivent dans le sous-dossier Profiles/ du profil, pas à côté de lui
        page_dir = f"Profiles/{profile_id}.sdProfile/Profiles/{page_id.upper()}"
        z.writestr(f"{page_dir}/manifest.json", json.dumps(page, indent=2))
        for key_id, p in images.items():
            z.write(p, f"{page_dir}/Images/{key_id}.png")
    print(target)


main()
