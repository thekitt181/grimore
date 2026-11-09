"""Slice assets2D free chest sheets into 256px frames (personal use; do not redistribute)."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from PIL import Image

DEST = Path(__file__).resolve().parents[1] / "public/props/assets2d"
CELL = 256

PACKS = [
    (Path.home() / "Downloads" / "Free Octopus Chest.zip", "octopus"),
    (Path.home() / "Downloads" / "Free Purple4.zip", "purple"),
    (Path.home() / "Downloads" / "Chest4_free.zip", "chest4"),
]


def slice_sheet(img: Image.Image, out: Path) -> int:
    cols = img.width // CELL
    rows = img.height // CELL
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for r in range(rows):
        for c in range(cols):
            tile = img.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            if tile.getbbox() is None:
                continue
            tile.save(out / f"{n:02d}.png")
            n += 1
    return n


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    for zip_path, stem in PACKS:
        with ZipFile(zip_path) as zf:
            pngs = [n for n in zf.namelist() if n.lower().endswith(".png")]
            print(zip_path.name, pngs)
            for name in pngs:
                img = Image.open(BytesIO(zf.read(name))).convert("RGBA")
                count = slice_sheet(img, DEST / stem)
                print(" ", name, img.size, "->", count, "frames")


if __name__ == "__main__":
    main()
