"""Download KayKit Dungeon Remastered prop GLBs (not walls/floors/stairs)."""
from __future__ import annotations

import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TREE = Path.home() / ".cursor/projects/c-Users-Admin-Desktop-grimoire-vtt/agent-tools/beb6cfe0-996f-426e-8d83-70b132f72a29.txt"
DEST = ROOT / "apps/client/public/props3d/kaykit"
BASE = "https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/raw/main/"
STRUCT = ("wall", "floor_", "stairs")


def stem_of(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    return name.replace(".gltf.glb", "").replace(".glb", "").replace(".gltf", "")


def prop_id(stem: str) -> str:
    s = re.sub(r"([a-z])([A-Z])", r"\1-\2", stem)
    return s.replace("_", "-").lower()


def title_of(stem: str) -> str:
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem).replace("_", " ")
    s = s.replace("pattern A", "pattern A").replace("pattern B", "pattern B").replace("pattern C", "pattern C")
    return s[:1].upper() + s[1:]


def rest_of(stem: str) -> str:
    return f"/props/kaykit/{stem}.png"


def short_of(title: str) -> str:
    parts = title.split()
    if len(title) <= 10:
        return title
    return (parts[0][:8] if parts else title[:8])


EXISTING_ART = {
    "chest",
    "sarcophagus",
    "coins",
    "crate",
    "barrel",
    "keg",
    "key",
    "boulder",
    "column",
    "torch",
    "candle",
    "campfire",
    "plate",
    "potion",
    "sword",
    "book",
    "ring",
    "shop",
}

# kaykit stem -> existing prop id (reuse 3D mapping, skip extra catalog row)
STEM_TO_EXISTING = {
    "chest": "chest",
    "chest_gold": "sarcophagus",
    "column": "column",
    "pillar": "pedestal",
    "keg": "keg",
    "key": "key",
    "torch": "torch",
    "candle": "candle",
    "coin": "coins",
    "barrel_small": "barrel",
}


def download(path: str, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return "skip"
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "grimoire-vtt"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if data[:4] != b"glTF" and not data[:4] == b"glTF":
        if not data.startswith(b"glTF"):
            # glb magic is glTF
            pass
    if not data.startswith(b"glTF"):
        raise RuntimeError(f"not glb: {path} {data[:20]!r}")
    dest.write_bytes(data)
    return "ok"


def main() -> None:
    tree = json.loads(TREE.read_text(encoding="utf-8"))["tree"]
    files = [
        t["path"]
        for t in tree
        if t.get("type") == "blob" and t["path"].lower().endswith((".glb", ".gltf"))
    ]
    jobs: list[tuple[str, str, Path]] = []
    for path in files:
        st = stem_of(path)
        if st.startswith(STRUCT) or st.startswith("stairs"):
            continue
        jobs.append((path, st, DEST / f"{st}.glb"))

    print("download", len(jobs))
    DEST.mkdir(parents=True, exist_ok=True)
    ok = 0
    fail: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download, path, dest): st for path, st, dest in jobs}
        for fut in as_completed(futs):
            st = futs[fut]
            try:
                fut.result()
                ok += 1
                print(" ", st)
            except Exception as e:
                fail.append(f"{st}: {e}")
                print(" FAIL", st, e)
    print("ok", ok, "fail", len(fail))
    for f in fail:
        print(" ", f)

    lines = [
        "/** Auto-generated KayKit Dungeon Remastered props (CC0). */",
        "import type { PropArt } from './propArt';",
        "import type { PropModelSpec } from '@/systems/map3d/propModels3d';",
        "",
        "const P = '/props3d/kaykit';",
        "",
        "export const KAYKIT_PROP_ART: PropArt[] = [",
    ]
    models: list[str] = []
    seen_ids: set[str] = set()
    for path, st, dest in sorted(jobs, key=lambda j: j[1].lower()):
        pid = STEM_TO_EXISTING.get(st) or prop_id(st)
        url = f"${{P}}/{st}.glb"
        light = ""
        if "torch" in st and "lit" in st or st in ("candle_lit", "candle_thin_lit", "candle_triple"):
            light = ", light: 'torch'"
        elif st.startswith("torch_lit"):
            light = ", light: 'torch'"
        models.append(f"  '{pid}': {{ url: `{url}`{light} }},")
        if st in STEM_TO_EXISTING:
            continue
        if pid in EXISTING_ART or pid in seen_ids:
            continue
        seen_ids.add(pid)
        title = title_of(st)
        rest = rest_of(st)
        motion = "loop" if ("lit" in st or st.startswith("candle")) and "melted" not in st else "none"
        play = "flicker" if motion == "loop" else "still"
        lines.append(
            "  { "
            + f"id: '{pid}', name: {title!r}, short: {short_of(title)!r}, "
            + f"motion: '{motion}', play: '{play}', rest: '{rest}'"
            + " },"
        )
    lines.append("];")
    lines.append("")
    lines.append("export const KAYKIT_PROP_MODELS: Record<string, PropModelSpec> = {")
    # unique model ids (last wins if duplicate)
    uniq: dict[str, str] = {}
    for m in models:
        key = m.split("'", 2)[1]
        uniq[key] = m
    lines.extend(uniq[k] for k in sorted(uniq))
    lines.append("};")
    lines.append("")
    out = ROOT / "apps/client/src/systems/map/props/kaykitPropCatalog.ts"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", out, "art", len(seen_ids), "models", len(uniq))


if __name__ == "__main__":
    main()
