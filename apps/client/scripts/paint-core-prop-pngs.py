"""32x32 dungeon-crawl sprites for leftover SVG placeholders."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "public" / "props"
K = (0, 0, 0, 0)


def canvas() -> list[list[tuple[int, int, int, int]]]:
    return [[K for _ in range(32)] for _ in range(32)]


def put(g, x, y, c):
    if 0 <= x < 32 and 0 <= y < 32:
        g[y][x] = c


def fill(g, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(g, x, y, c)


def save(name: str, g):
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = im.load()
    for y in range(32):
        for x in range(32):
            px[x, y] = g[y][x]
    path = OUT / name
    im.save(path)
    print("wrote", path.name)


def mural():
    g = canvas()
    stone = (86, 78, 70, 255)
    dark = (48, 42, 36, 255)
    plaster = (122, 108, 92, 255)
    fade = (96, 82, 68, 255)
    ochre = (168, 124, 64, 220)
    gold = (186, 150, 70, 200)
    wash = (40, 32, 26, 90)
    fill(g, 4, 5, 27, 28, dark)
    fill(g, 5, 6, 26, 27, stone)
    fill(g, 7, 8, 24, 22, plaster)
    fill(g, 8, 9, 23, 21, fade)
    # faded standing figure
    fill(g, 14, 10, 17, 12, ochre)  # head
    fill(g, 13, 13, 18, 19, ochre)  # torso
    put(g, 12, 14, ochre)
    put(g, 19, 14, ochre)
    fill(g, 13, 20, 15, 24, (120, 90, 50, 180))
    fill(g, 16, 20, 18, 24, (110, 82, 46, 160))
    # sun disk
    for x, y in ((10, 11), (11, 10), (11, 11), (12, 11)):
        put(g, x, y, gold)
    # cracks
    for x, y in ((9, 16), (10, 17), (20, 13), (21, 14), (22, 18)):
        put(g, x, y, dark)
    fill(g, 7, 23, 24, 24, wash)
    # frame highlights
    for x in range(5, 27):
        put(g, x, 6, (140, 128, 110, 255))
        put(g, x, 27, (36, 30, 26, 255))
    save("mural.png", g)


def weapon_rack():
    g = canvas()
    wood = (90, 54, 28, 255)
    wood_d = (52, 28, 14, 255)
    wood_l = (122, 74, 36, 255)
    iron = (164, 172, 184, 255)
    gold = (201, 168, 76, 255)
    fill(g, 6, 6, 25, 26, wood_d)
    fill(g, 7, 7, 24, 24, wood)
    fill(g, 7, 12, 24, 13, wood_l)
    fill(g, 7, 19, 24, 20, wood_l)
    # hanging blades
    for x, h, c in ((10, 14, iron), (14, 16, (184, 188, 196, 255)), (18, 13, iron), (22, 15, gold)):
        fill(g, x, 8, x + 1, 8 + h, c)
        put(g, x - 1, 8 + h - 1, wood_d)
        put(g, x + 2, 8 + h - 1, wood_d)
    fill(g, 5, 25, 26, 27, wood_d)
    save("weapon-rack.png", g)


def cage():
    g = canvas()
    iron = (90, 90, 98, 255)
    dark = (40, 40, 46, 255)
    wood = (74, 48, 24, 255)
    fill(g, 6, 24, 25, 27, wood)
    fill(g, 7, 8, 24, 24, dark)
    for x in range(8, 25, 3):
        fill(g, x, 8, x, 24, iron)
    for y in range(10, 24, 4):
        fill(g, 8, y, 23, y, iron)
    fill(g, 7, 7, 24, 8, iron)
    fill(g, 7, 23, 24, 24, iron)
    put(g, 15, 16, (201, 168, 76, 255))  # lock
    save("cage.png", g)


def art_object():
    g = canvas()
    ped = (90, 82, 74, 255)
    ped_d = (52, 46, 40, 255)
    gold = (201, 168, 76, 255)
    hi = (232, 214, 140, 255)
    fill(g, 10, 24, 21, 28, ped_d)
    fill(g, 12, 20, 19, 24, ped)
    # figurine
    fill(g, 14, 8, 17, 10, hi)
    fill(g, 13, 11, 18, 18, gold)
    put(g, 12, 13, gold)
    put(g, 19, 13, gold)
    fill(g, 14, 19, 17, 20, gold)
    put(g, 15, 9, (40, 32, 24, 255))
    put(g, 16, 9, (40, 32, 24, 255))
    save("art-object.png", g)


def swarm():
    g = canvas()
    body = (28, 24, 20, 255)
    wing = (48, 40, 32, 255)
    bats = [
        (8, 10), (14, 7), (20, 11), (25, 8),
        (10, 16), (17, 14), (23, 17),
        (12, 21), (19, 20), (7, 18),
    ]
    for x, y in bats:
        put(g, x, y, body)
        put(g, x - 1, y, wing)
        put(g, x + 1, y, wing)
        put(g, x - 2, y + 1, wing)
        put(g, x + 2, y + 1, wing)
    save("swarm.png", g)


def floor_glyph():
    g = canvas()
    stone = (70, 66, 78, 255)
    ink = (90, 70, 210, 255)
    glow = (155, 125, 255, 255)
    fill(g, 6, 6, 25, 25, stone)
    # ring
    for x, y in [
        (16, 7), (20, 8), (23, 11), (24, 16), (23, 20), (20, 23),
        (16, 24), (12, 23), (9, 20), (8, 16), (9, 11), (12, 8),
    ]:
        put(g, x, y, glow)
        put(g, x + (1 if x < 16 else -1), y, ink)
    fill(g, 14, 14, 17, 17, glow)
    put(g, 16, 12, ink)
    put(g, 16, 19, ink)
    put(g, 12, 16, ink)
    put(g, 19, 16, ink)
    save("floor-glyph.png", g)


def tripwire():
    g = canvas()
    post = (74, 48, 24, 255)
    iron = (90, 90, 98, 255)
    wire = (176, 168, 156, 255)
    fill(g, 4, 20, 7, 28, post)
    fill(g, 24, 8, 27, 16, post)
    fill(g, 4, 19, 7, 20, iron)
    fill(g, 24, 7, 27, 8, iron)
    # diagonal wire
    pts = [
        (8, 20), (10, 19), (12, 18), (14, 17), (16, 16),
        (18, 15), (20, 14), (22, 13), (23, 12),
    ]
    for x, y in pts:
        put(g, x, y, wire)
    save("tripwire.png", g)


def ring():
    g = canvas()
    gold = (201, 168, 76, 255)
    hi = (232, 214, 140, 255)
    dk = (120, 88, 36, 255)
    gem = (70, 140, 210, 255)
    gem_h = (180, 220, 255, 255)
    # band
    for x, y in [
        (10, 18), (11, 17), (12, 16), (13, 16), (14, 16), (15, 16),
        (16, 16), (17, 16), (18, 16), (19, 17), (20, 18), (21, 19),
        (21, 20), (20, 21), (19, 22), (18, 23), (17, 23), (16, 23),
        (15, 23), (14, 23), (13, 23), (12, 22), (11, 21), (10, 20),
        (10, 19),
    ]:
        put(g, x, y, gold)
    for x, y in [(12, 17), (13, 17), (18, 17), (19, 18), (14, 22), (17, 22)]:
        put(g, x, y, hi)
    for x, y in [(11, 20), (12, 21), (19, 21), (20, 20)]:
        put(g, x, y, dk)
    # setting + gem
    fill(g, 14, 12, 17, 15, gold)
    fill(g, 15, 13, 16, 14, gem)
    put(g, 15, 13, gem_h)
    save("ring.png", g)


if __name__ == "__main__":
    mural()
    weapon_rack()
    cage()
    art_object()
    swarm()
    floor_glyph()
    tripwire()
    ring()
