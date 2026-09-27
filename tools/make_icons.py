"""Рисует иконки приложения (PWA и Android) из SVG."""
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
NOTE = ('<g fill="none" stroke="#fff" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" transform="translate({tx} {ty}) scale({s})">'
        '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></g>')

def svg(size, radius, glyph_scale):
    s = size * glyph_scale / 24
    tx = ty = (size - 24 * s) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" rx="{radius}" fill="#8c2331"/>'
            + NOTE.format(sw=1.8, tx=tx, ty=ty, s=s) + '</svg>')

def png(svg_text, out):
    doc = pymupdf.open(stream=svg_text.encode(), filetype="svg")
    doc[0].get_pixmap(alpha=True).save(out)

icons = ROOT / "site" / "icons"
icons.mkdir(parents=True, exist_ok=True)
(icons / "favicon.svg").write_text(svg(64, 14, 0.62), "utf-8")
png(svg(192, 42, 0.58), icons / "icon-192.png")
png(svg(512, 112, 0.58), icons / "icon-512.png")
png(svg(512, 0, 0.46), icons / "icon-maskable-512.png")   # безопасная зона для маски Android

res = ROOT / "android" / "app" / "src" / "main" / "res"
for d, px in {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}.items():
    (res / d).mkdir(parents=True, exist_ok=True)
    png(svg(px, px * 0.22, 0.58), res / d / "ic_launcher.png")
print("ok")
