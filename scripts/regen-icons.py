"""Regenera todos os icones do SO a partir de assets/brand/vortex-borded-1024.png.

Uso:
    python scripts/regen-icons.py

O que faz:
  1. Deriva a fonte com quiet-zone (assets/brand/vortex-borded-1024.png, 1024)
     a partir de assets/brand/vortex-borded.png, cujo conteudo encosta na
     borda (margem T/B ~1%) e por isso serrilha em 16/32px.
  2. Renderiza com Pillow/LANCZOS todos os PNGs de apps/desktop/src-tauri/icons
     (base, tiles Windows, mipmaps Android, iconset iOS).
  3. Reconstroi icon.ico com 15 entradas (16->256, incluindo os tamanhos
     intermediarios de HiDPI que o Windows 10/11 pede em 125/150/175% e que o
     `tauri icon` nao gera) e icon.icns com 11 entradas (16->1024).
  4. Recentraliza nsis-header.bmp (150x57) e nsis-sidebar.bmp (164x314) em 24bpp
     com fundo #0B0E11 (theme-color do app).

Requer: Pillow (pip install pillow).
"""

import io
import os
import struct

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "assets", "brand")
ICONS = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")

UPSTREAM = os.path.join(BRAND, "vortex-borded.png")
SRC = os.path.join(BRAND, "vortex-borded-1024.png")
CANVAS = 1024
MARGIN = 0.12
BG = (11, 14, 17)  # #0B0E11, theme-color do app

# (caminho relativo a icons/, lado em px)
PNG_TARGETS = [
    ("icon.png", 512),
    ("app-icon.png", 512),
    ("32x32.png", 32),
    ("64x64.png", 64),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("StoreLogo.png", 50),
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    # Android (hdpi = 72; o set antigo tinha 49x49 gerado errado)
    ("android/mipmap-mdpi/ic_launcher.png", 48),
    ("android/mipmap-mdpi/ic_launcher_round.png", 48),
    ("android/mipmap-hdpi/ic_launcher.png", 72),
    ("android/mipmap-hdpi/ic_launcher_round.png", 72),
    ("android/mipmap-xhdpi/ic_launcher.png", 96),
    ("android/mipmap-xhdpi/ic_launcher_round.png", 96),
    ("android/mipmap-xxhdpi/ic_launcher.png", 144),
    ("android/mipmap-xxhdpi/ic_launcher_round.png", 144),
    ("android/mipmap-xxxhdpi/ic_launcher.png", 192),
    ("android/mipmap-xxxhdpi/ic_launcher_round.png", 192),
    ("android/mipmap-mdpi/ic_launcher_foreground.png", 108),
    ("android/mipmap-hdpi/ic_launcher_foreground.png", 162),
    ("android/mipmap-xhdpi/ic_launcher_foreground.png", 216),
    ("android/mipmap-xxhdpi/ic_launcher_foreground.png", 324),
    ("android/mipmap-xxxhdpi/ic_launcher_foreground.png", 432),
    # iOS (inclui os duplicados -1 que o tauri CLI gera)
    ("ios/AppIcon-20x20@1x.png", 20),
    ("ios/AppIcon-20x20@2x.png", 40),
    ("ios/AppIcon-20x20@2x-1.png", 40),
    ("ios/AppIcon-20x20@3x.png", 60),
    ("ios/AppIcon-29x29@1x.png", 29),
    ("ios/AppIcon-29x29@2x.png", 58),
    ("ios/AppIcon-29x29@2x-1.png", 58),
    ("ios/AppIcon-29x29@3x.png", 87),
    ("ios/AppIcon-40x40@1x.png", 40),
    ("ios/AppIcon-40x40@2x.png", 80),
    ("ios/AppIcon-40x40@2x-1.png", 80),
    ("ios/AppIcon-40x40@3x.png", 120),
    ("ios/AppIcon-60x60@2x.png", 120),
    ("ios/AppIcon-60x60@3x.png", 180),
    ("ios/AppIcon-76x76@1x.png", 76),
    ("ios/AppIcon-76x76@2x.png", 152),
    ("ios/AppIcon-83.5x83.5@2x.png", 167),
    ("ios/AppIcon-512@2x.png", 1024),
]

# Conjunto completo que o Windows 10/11 pede (inclui HiDPI fracionario).
ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]

# icns moderno: inclui 16/32/64 (o set antigo so tinha 128+).
ICNS_ENTRIES = [
    ("icp4", 16), ("icp5", 32), ("ic11", 32),
    ("icp6", 64), ("ic12", 64),
    ("ic07", 128),
    ("ic08", 256), ("ic13", 256),
    ("ic09", 512), ("ic14", 512),
    ("ic10", 1024),
]

# (nome, (largura, altura), fracao da altura ocupada pelo logo)
INSTALLER_BMPS = [
    ("nsis-header.bmp", (150, 57), 0.86),
    ("nsis-sidebar.bmp", (164, 314), 0.42),
]


def build_source() -> Image.Image:
    """Recorta o conteudo do borded original e centraliza num canvas com margem."""
    im = Image.open(UPSTREAM).convert("RGBA")
    bbox = im.getbbox()
    if bbox is None:
        raise ValueError("upstream %s sem conteudo" % UPSTREAM)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    target = int(CANVAS * (1 - 2 * MARGIN))
    scale = min(target / bw, target / bh)
    nw, nh = round(bw * scale), round(bh * scale)
    resized = im.crop(bbox).resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(resized, ((CANVAS - nw) // 2, (CANVAS - nh) // 2), resized)
    canvas.save(SRC, "PNG")
    return canvas


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def build_ico(renders: dict) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(ICO_SIZES))
    entries = b""
    images = b""
    offset = 6 + 16 * len(ICO_SIZES)
    for s in ICO_SIZES:
        data = png_bytes(renders[s])
        w = 0 if s == 256 else s
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        images += data
        offset += len(data)
    return header + entries + images


def build_icns(renders: dict) -> bytes:
    body = b""
    for kind, size in ICNS_ENTRIES:
        data = png_bytes(renders[size])
        body += kind.encode("ascii") + struct.pack(">I", 8 + len(data)) + data
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main() -> None:
    src = build_source()
    print("fonte: %s %dx%d" % (os.path.relpath(SRC, ROOT), src.size[0], src.size[1]))

    cache: dict = {}
    for _rel, size in PNG_TARGETS:
        if size not in cache:
            cache[size] = src.resize((size, size), Image.LANCZOS)
    for s in ICO_SIZES:
        if s not in cache:
            cache[s] = src.resize((s, s), Image.LANCZOS)

    for rel, size in PNG_TARGETS:
        dest = os.path.join(ICONS, rel.replace("/", os.sep))
        cache[size].save(dest, "PNG")
    print("PNGs: %d" % len(PNG_TARGETS))

    with open(os.path.join(ICONS, "icon.ico"), "wb") as f:
        f.write(build_ico(cache))
    print("icon.ico: %s" % ICO_SIZES)

    with open(os.path.join(ICONS, "icon.icns"), "wb") as f:
        f.write(build_icns(cache))
    print("icon.icns: %s" % [k for k, _ in ICNS_ENTRIES])

    for name, (w, h), frac in INSTALLER_BMPS:
        side = int(h * frac)
        logo = src.resize((side, side), Image.LANCZOS)
        bmp = Image.new("RGB", (w, h), BG)
        bmp.paste(logo, ((w - side) // 2, (h - side) // 2), logo)
        bmp.save(os.path.join(ICONS, name), "BMP")
        print("%s: %dx%d logo=%d" % (name, w, h, side))


if __name__ == "__main__":
    main()
