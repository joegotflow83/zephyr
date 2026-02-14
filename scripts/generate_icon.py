#!/usr/bin/env python3
"""Generate the Zephyr Desktop application icon.

Creates a 512x512 PNG icon with a stylised "Z" letter on a blue
gradient rounded-rectangle background.  The output is written to
``resources/icon.png``.

Usage:
    python3 scripts/generate_icon.py
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _rounded_rect(draw, xy, radius, fill):
    """Draw a filled rounded rectangle."""
    x0, y0, x1, y1 = xy
    # Four corner circles
    draw.ellipse([x0, y0, x0 + 2 * radius, y0 + 2 * radius], fill=fill)
    draw.ellipse([x1 - 2 * radius, y0, x1, y0 + 2 * radius], fill=fill)
    draw.ellipse([x0, y1 - 2 * radius, x0 + 2 * radius, y1], fill=fill)
    draw.ellipse([x1 - 2 * radius, y1 - 2 * radius, x1, y1], fill=fill)
    # Two overlapping rectangles to fill the interior
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)


def generate_icon(size: int = 512, output_path: str | None = None) -> Path:
    """Generate the Zephyr icon and save as PNG.

    Parameters
    ----------
    size : int
        Width and height of the icon in pixels (default 512).
    output_path : str | None
        Where to write the file.  Defaults to ``resources/icon.png``
        relative to the project root.

    Returns
    -------
    Path
        Absolute path to the generated file.
    """
    project_root = Path(__file__).resolve().parent.parent
    if output_path is None:
        out = project_root / "resources" / "icon.png"
    else:
        out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # --- Background: gradient rounded rectangle -------------------------
    margin = int(size * 0.04)
    radius = int(size * 0.18)

    # Build vertical gradient from top-blue to bottom-blue
    top_colour = (41, 98, 255)  # bright blue
    bot_colour = (13, 42, 148)  # deeper blue

    for y in range(margin, size - margin):
        t = (y - margin) / (size - 2 * margin - 1)
        r = int(top_colour[0] + t * (bot_colour[0] - top_colour[0]))
        g = int(top_colour[1] + t * (bot_colour[1] - top_colour[1]))
        b = int(top_colour[2] + t * (bot_colour[2] - top_colour[2]))
        draw.line([(margin, y), (size - margin - 1, y)], fill=(r, g, b, 255))

    # Apply rounded-rect mask
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    _rounded_rect(
        mask_draw, (margin, margin, size - margin, size - margin), radius, 255
    )
    img.putalpha(mask)

    # --- Letter "Z" in white -------------------------------------------
    draw = ImageDraw.Draw(img)  # re-acquire after alpha change

    # Try to use a bold system font; fall back to default
    font_size = int(size * 0.52)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size
        )
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("Arial Bold", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

    letter = "Z"
    bbox = draw.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]

    # Subtle shadow
    shadow_offset = max(2, size // 128)
    draw.text(
        (tx + shadow_offset, ty + shadow_offset),
        letter,
        fill=(0, 0, 40, 100),
        font=font,
    )
    # Main letter
    draw.text((tx, ty), letter, fill=(255, 255, 255, 255), font=font)

    img.save(str(out), "PNG")
    return out


if __name__ == "__main__":
    path = generate_icon()
    print(f"Icon generated: {path}")
