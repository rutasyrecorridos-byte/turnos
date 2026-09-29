"""
Genera todos los recursos gráficos de Android a partir de los SVG de /resources.
Solo hace falta volver a ejecutarlo si cambias el icono:
    pip install cairosvg pillow
    python scripts/generate_icons.py
"""
import io, os, re
import cairosvg
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES_SRC = os.path.join(ROOT, "resources")
OUT = os.path.join(RES_SRC, "android", "res")
BG = "#ffffff"

def svg_png(name, size, text=None):
    data = text if text is not None else open(os.path.join(RES_SRC, name), encoding="utf-8").read()
    png = cairosvg.svg2png(bytestring=data.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")

def layered(name, size):
    """Renderiza SVG con capas: BASE - CUT1 + círculo - CUT2 (CUT = zonas transparentes)."""
    from PIL import ImageChops
    src = open(os.path.join(RES_SRC, name), encoding="utf-8").read()
    pre, body = src.split("<!--BODY-->", 1)
    base, rest = body.split("<!--CUT1-->", 1)
    cut1, rest = rest.split("<!--/CUT1-->", 1)
    mid, rest = rest.split("<!--CUT2-->", 1)
    cut2, tail = rest.split("<!--/CUT2-->", 1)
    A = lambda part: svg_png(None, size, pre + part + tail).getchannel("A")
    alpha = ImageChops.subtract(A(base), A(cut1))
    alpha = ImageChops.lighter(alpha, A(mid))
    alpha = ImageChops.subtract(alpha, A(cut2))
    out = Image.new("RGBA", (size, size), (255, 255, 255, 0)); out.putalpha(alpha)
    return out

def save(img, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)

icon_src = open(os.path.join(RES_SRC, "icon.svg"), encoding="utf-8").read()
# Versión a sangre (sin esquinas redondeadas) para recortes circulares
icon_square = icon_src.replace('rx="112" fill="url(#bgGrad)"', 'fill="url(#bgGrad)"')

densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, k in densities.items():
    s = int(48 * k)
    save(svg_png(None, s, icon_src), f"mipmap-{d}/ic_launcher.png")
    sq = svg_png(None, s, icon_square)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, s - 1, s - 1), fill=255)
    rnd = Image.new("RGBA", (s, s), (0, 0, 0, 0)); rnd.paste(sq, (0, 0), mask)
    save(rnd, f"mipmap-{d}/ic_launcher_round.png")
    f = int(108 * k)
    save(svg_png("icon-foreground.svg", f), f"mipmap-{d}/ic_launcher_foreground.png")
    save(layered("icon-monochrome.svg", f), f"mipmap-{d}/ic_launcher_monochrome.png")
    n = int(24 * k)
    save(layered("notification.svg", n), f"drawable-{d}/ic_stat_turnos.png")

adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
"""
for n in ("ic_launcher", "ic_launcher_round"):
    p = os.path.join(OUT, "mipmap-anydpi-v26", n + ".xml")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write(adaptive)
p = os.path.join(OUT, "values", "ic_launcher_background.xml")
os.makedirs(os.path.dirname(p), exist_ok=True)
open(p, "w").write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#131d33</color>\n</resources>\n')

# Pantallas de arranque (mismos tamaños que la plantilla de Capacitor 7)
splash = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320), "drawable-land-hdpi": (800, 480), "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960), "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480), "drawable-port-hdpi": (480, 800), "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600), "drawable-port-xxxhdpi": (1280, 1920),
}
for folder, (w, h) in splash.items():
    img = Image.new("RGBA", (w, h), BG)
    s = int(min(w, h) * 0.36)
    logo = svg_png(None, s, icon_src)
    img.paste(logo, ((w - s) // 2, (h - s) // 2), logo)
    save(img.convert("RGB"), f"{folder}/splash.png")

# Copia del logo para la web
import shutil
shutil.copy(os.path.join(RES_SRC, "icon.svg"), os.path.join(ROOT, "www", "img", "logo.svg"))
save_web = svg_png(None, 192, icon_src); save_web.save(os.path.join(ROOT, "www", "img", "icon-192.png"))
svg_png(None, 512, icon_src).save(os.path.join(ROOT, "www", "img", "icon-512.png"))
print("Recursos generados en", OUT)
