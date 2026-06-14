"""Remove olive/glow background from logo-source.png → logo.png (transparent)."""
from __future__ import annotations

import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'public' / 'logo-source.png'
OUT = ROOT / 'public' / 'logo.png'
BG = np.array([49, 41, 22])


def is_bg(c: np.ndarray) -> bool:
    return int(np.abs(c.astype(int) - BG).sum()) < 58


def is_removable_glow(c: np.ndarray) -> bool:
    r, g, b = map(int, c)
    if max(r, g, b) > 248:
        return False
    if is_bg(c):
        return True
    if b < 100 and r > 50 and g > 40 and (r + g) > int(b * 2.2 + 25):
        return True
    if r < 75 and g < 65 and b < 45:
        return True
    return False


def main() -> None:
    arr = np.array(Image.open(SRC).convert('RGBA'))
    h, w = arr.shape[:2]
    cx, cy = w / 2, h / 2

    removed = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if removed[y, x]:
            continue
        if not is_removable_glow(arr[y, x, :3]):
            continue
        removed[y, x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not removed[ny, nx]:
                q.append((nx, ny))

    protect_radius = 335
    for y in range(h):
        for x in range(w):
            if not removed[y, x]:
                continue
            d = math.hypot(x - cx, y - cy)
            if d < protect_radius and not is_bg(arr[y, x, :3]):
                removed[y, x] = False

    arr[removed, 3] = 0
    Image.fromarray(arr).save(OUT)
    print(f'Wrote {OUT} ({w}x{h}), removed {int(removed.sum())} px')


if __name__ == '__main__':
    main()
