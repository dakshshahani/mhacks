#!/usr/bin/env python3
"""Build apps/desktop/build/icon.icns from the brand mark.

Source of truth: apps/frontend/public/gaze-mark.svg (hand-drawn "e" stroke,
purple #C98BFF -> teal #76E0E5 radial). Rendered large via a scaled SVG copy
(QuickLook renders at nominal size), trimmed, composited centered on the
landing frame tile (#0A0A0A rounded square), then iconset -> icns.

macOS-only (qlmanage, iconutil, sips). Deterministic; rerun after any mark
change:  python3 scripts/make-icon.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(REPO, "..", "frontend", "public", "gaze-mark.svg")
BUILD = os.path.join(REPO, "build")
ICNS = os.path.join(BUILD, "icon.icns")
TILE = 1024


def run(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAILED: {' '.join(args)}\n{r.stderr[:500]}", file=sys.stderr)
        sys.exit(1)
    return r


def main():
    src = open(SVG).read()
    # Scale the artwork x24 (34x37 -> ~816x888) so the thumbnail has pixels.
    big = re.sub(
        r'width="34" height="37"',
        'width="816" height="888"',
        src,
        count=1,
    )
    tmp = tempfile.mkdtemp(prefix="gaze-icon-")
    big_path = os.path.join(tmp, "gaze-mark-big.svg")
    open(big_path, "w").write(big)
    run("qlmanage", "-t", "-s", "1024", "-o", tmp, big_path)
    rendered = os.path.join(tmp, "gaze-mark-big.svg.png")
    # QuickLook bakes a white background: key near-white out to transparency
    # (the mark is purple->teal strokes; nothing in it is near-white, so a
    # luminance-of-difference matte keeps anti-aliased edges smooth).
    from PIL import ImageChops

    ql = Image.open(rendered).convert("RGB")
    white = Image.new("RGB", ql.size, (255, 255, 255))
    matte = ImageChops.difference(ql, white).convert("L").point(lambda v: min(255, v * 3))
    mark = ql.convert("RGBA")
    mark.putalpha(matte)

    # Trim transparent margins to the stroke bounds.
    bbox = mark.getchannel("A").getbbox()
    if not bbox:
        print("empty render", file=sys.stderr)
        sys.exit(1)
    mark = mark.crop(bbox)

    # Tile: landing frame bg, rounded square.
    tile = Image.new("RGB", (TILE, TILE), (10, 10, 10))
    mask = Image.new("L", (TILE, TILE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, TILE, TILE], radius=225, fill=255)

    # Fit the mark to ~58% of the tile, centered (slightly high, optical).
    target = int(TILE * 0.58)
    scale = target / max(mark.size)
    mark = mark.resize((int(mark.size[0] * scale), int(mark.size[1] * scale)), Image.LANCZOS)
    tile.paste(mark, ((TILE - mark.size[0]) // 2, (TILE - mark.size[1]) // 2 - 10), mark)
    tile.putalpha(mask)

    iconset = os.path.join(tmp, "gaze.iconset")
    os.makedirs(iconset)
    for s in (16, 32, 128, 256, 512):
        for suffix, size in (("", s), ("@2x", s * 2)):
            p = os.path.join(iconset, f"icon_{s}x{s}{suffix}.png")
            tile.resize((size, size), Image.LANCZOS).save(p)
    os.makedirs(BUILD, exist_ok=True)
    run("iconutil", "-c", "icns", iconset, "-o", ICNS)
    print(f"wrote {ICNS} ({os.path.getsize(ICNS)//1024}KB)")
    shutil.rmtree(tmp, ignore_errors=True)


main()
