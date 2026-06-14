"""Generate favicon + UI-sized logos from public/logo.png."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'public' / 'logo.png'
PUBLIC = ROOT / 'public'


def main() -> None:
    img = Image.open(SRC).convert('RGBA')
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit('logo.png has no opaque pixels')
    cropped = img.crop(bbox)
    # square canvas with small padding
    side = max(cropped.size) + 8
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ox = (side - cropped.width) // 2
    oy = (side - cropped.height) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    canvas.save(PUBLIC / 'logo.png')

    for name, px in [('favicon-32.png', 32), ('favicon-192.png', 192), ('apple-touch-icon.png', 180)]:
        canvas.resize((px, px), Image.Resampling.LANCZOS).save(PUBLIC / name)

    print('Updated logo.png (cropped) + favicon sizes')


if __name__ == '__main__':
    main()
