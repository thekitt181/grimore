"""Slice Sprites Chest potions into /props/sazkuash (personal use; do not redistribute)."""
from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image

ZIP = Path.home() / "Downloads" / "32x32_rpg_animated_potions_pack_v1.zip"
DEST = Path(__file__).resolve().parents[1] / "public/props/sazkuash"
FRAME = 32


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP) as zf:
        sheets = [n for n in zf.namelist() if n.startswith("spritesheet/potions/") and n.endswith(".png")]
        for name in sheets:
            stem = Path(name).stem
            img = Image.open(BytesIO(zf.read(name))).convert("RGBA")
            n = img.width // FRAME
            out = DEST / stem
            out.mkdir(exist_ok=True)
            for i in range(n):
                img.crop((i * FRAME, 0, (i + 1) * FRAME, FRAME)).save(out / f"{i:02d}.png")
            print(stem, n, "frames")


if __name__ == "__main__":
    main()
