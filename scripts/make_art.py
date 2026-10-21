"""Draws the app's paper textures and home-screen icons.

Everything is drawn here so it can be changed and redrawn; nothing is
downloaded. Run from the repo root:

    python3 scripts/make_art.py

Needs Pillow (python3 -m pip install pillow). The output is committed under
web/public, so only run this when changing the art.
"""

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parent.parent / "web" / "public"

PAPER = (245, 243, 238, 255)
INK = (27, 29, 33, 255)
HEART = (214, 92, 84, 255)


def grain(path, ink, alpha_scale):
    """A tileable see-through layer of speckles and paper fibres, laid over
    every sheet in the app with CSS so the colours underneath stay themable."""
    size = 256
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = im.load()
    for y in range(size):
        for x in range(size):
            v = random.random()
            a = 0
            if v < 0.22:
                a = int(random.random() * 14 * alpha_scale)
            if v < 0.015:
                a = int((18 + random.random() * 22) * alpha_scale)
            px[x, y] = (*ink, a)

    d = ImageDraw.Draw(im)
    for _ in range(70):
        x = random.random() * size
        y = random.random() * size
        ang = random.random() * math.pi
        length = 6 + random.random() * 22
        pts = []
        for i in range(8):
            t = i / 7
            pts.append(
                (
                    (x + math.cos(ang) * length * t + math.sin(t * 3) * 1.5) % size,
                    (y + math.sin(ang) * length * t) % size,
                )
            )
        d.line(pts, fill=(*ink, int((10 + random.random() * 14) * alpha_scale)), width=1)

    im = im.filter(ImageFilter.GaussianBlur(0.35))
    im.save(path, optimize=True)


def icon(size, path, maskable=False):
    """A kitchen table in ink with a heart over it. Drawn at four times the
    size and scaled down for smooth edges."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = 0 if maskable else int(s * 0.06)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=0 if maskable else int(s * 0.22), fill=PAPER)

    # Table top and legs, as thick ink strokes. A maskable icon gets cropped
    # to a circle, so its table is narrower.
    cx = s / 2
    w = s * 0.26 if maskable else s * 0.30
    top = s * 0.56
    lw = int(s * 0.045)
    d.rounded_rectangle([cx - w, top, cx + w, top + lw], radius=lw // 2, fill=INK)
    d.rounded_rectangle([cx - w * 0.8, top, cx - w * 0.8 + lw, top + s * 0.17], radius=lw // 2, fill=INK)
    d.rounded_rectangle([cx + w * 0.8 - lw, top, cx + w * 0.8, top + s * 0.17], radius=lw // 2, fill=INK)

    hs = s * 0.11
    hx, hy = cx, top - s * 0.15
    heart = []
    for i in range(200):
        t = i / 200 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        heart.append((hx + x * hs / 16, hy - y * hs / 16))
    d.polygon(heart, fill=HEART)

    im = im.resize((size, size), Image.LANCZOS)
    im.save(path)


def main():
    random.seed(7)
    (PUBLIC / "textures").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "icons").mkdir(parents=True, exist_ok=True)

    grain(PUBLIC / "textures" / "paper-light.png", (70, 55, 30), 1.0)
    grain(PUBLIC / "textures" / "paper-dark.png", (255, 250, 235), 0.7)

    icon(192, PUBLIC / "icons" / "icon-192.png")
    icon(512, PUBLIC / "icons" / "icon-512.png")
    icon(512, PUBLIC / "icons" / "maskable-512.png", maskable=True)
    icon(180, PUBLIC / "icons" / "apple-180.png")
    print("Drew the textures and icons in", PUBLIC)


if __name__ == "__main__":
    main()
