"""Рисует иконки приложения (PWA и Android) и знак в шапке сайта из site/icons/emblem.svg —
знака Петрозаводской консерватории."""
import re
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
EMBLEM = (ROOT / "site" / "icons" / "emblem.svg").read_text("utf-8")
VB = re.search(r'viewBox="([^"]+)"', EMBLEM).group(1)
VX, VY, VW, VH = map(float, VB.split())
PATHS = re.findall(r'<path fill="([^"]+)"( fill-rule="evenodd")? d="([^"]+)"/>', EMBLEM)
BODY = "".join(re.findall(r"<path[^>]*/>", EMBLEM))

def fit(size, height):
    """Сдвиг и масштаб, при которых знак высотой height·size стоит по центру квадрата size."""
    s = size * height / VH
    return (size - VW * s) / 2 - VX * s, (size - VH * s) / 2 - VY * s, s

def svg(size, radius, height):
    tx, ty, s = fit(size, height)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" rx="{radius:g}" fill="#fff"/>'
            f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">{BODY}</g></svg>')

def png(svg_text, out):
    doc = pymupdf.open(stream=svg_text.encode(), filetype="svg")
    doc[0].get_pixmap(alpha=True).save(out)

icons = ROOT / "site" / "icons"
(icons / "favicon.svg").write_text(svg(64, 14, 0.86), "utf-8")
png(svg(192, 42, 0.78), icons / "icon-192.png")
png(svg(512, 112, 0.78), icons / "icon-512.png")
png(svg(512, 0, 0.70), icons / "icon-maskable-512.png")   # безопасная зона маски — круг 80%
png(svg(180, 0, 0.76), icons / "apple-touch-icon.png")     # iPhone сам скругляет углы

# знак в шапке сайта: цвета задаёт app.css (в тёмной теме чёрное становится светлым)
cls = {"#83409B": "v", "#91989D": "g", "#000": "k"}
inline = (f'<svg class="emblem" viewBox="{VB}">'
          + "".join(f'<path class="{cls[f]}"{r} d="{d}"/>' for f, r, d in PATHS) + "</svg>")
index = ROOT / "site" / "index.html"
html = index.read_text("utf-8")
html, n = re.subn(r'<svg class="emblem".*?</svg>', lambda _: inline, html, count=1, flags=re.S)
assert n == 1, "в index.html нет <svg class=\"emblem\">"
index.write_text(html, "utf-8")

res = ROOT / "android" / "app" / "src" / "main" / "res"
for d, px in {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}.items():
    (res / d).mkdir(parents=True, exist_ok=True)
    png(svg(px, px * 0.22, 0.78), res / d / "ic_launcher.png")

# адаптивная иконка Android 8+: белый фон и векторный знак, в безопасной зоне (круг 66 из 108 dp)
tx, ty, s = fit(108, 60 / 108)
even = ' android:fillType="evenOdd"'
vector = ('<?xml version="1.0" encoding="utf-8"?>\n'
          '<!-- Создано tools/make_icons.py из site/icons/emblem.svg -->\n'
          '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
          '    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n'
          f'    <group android:translateX="{tx:.3f}" android:translateY="{ty:.3f}" android:scaleX="{s:.5f}" android:scaleY="{s:.5f}">\n'
          + "".join(f'        <path android:fillColor="{f}"{even if r else ""} android:pathData="{d}" />\n'
                    for f, r, d in PATHS)
          + '    </group>\n</vector>\n')
(res / "drawable" / "ic_launcher_foreground.xml").write_text(vector, "utf-8")
(res / "mipmap-anydpi-v26").mkdir(exist_ok=True)
(res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@android:color/white" />\n'
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
    '    <monochrome android:drawable="@drawable/ic_launcher_foreground" />\n'
    '</adaptive-icon>\n', "utf-8")
print("ok")
