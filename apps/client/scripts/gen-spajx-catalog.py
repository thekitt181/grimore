from pathlib import Path

p = Path(r"C:\Users\Admin\Desktop\grimoire-vtt\apps\client\public\props3d\spajx")
stems = sorted(g.stem for g in p.glob("*.glb"))
out = Path(r"C:\Users\Admin\Desktop\grimoire-vtt\apps\client\src\systems\map\props\spajxPropCatalog.ts")
lines = [
    "/**",
    " * Storage Chests and Treasure Boxes: 50 3D Models by spajx123c (itch.io).",
    " * Personal End Product; do not redistribute the models.",
    " * https://spajx123c.itch.io/storage-chests-treasure-boxes-50-3d-models",
    " */",
    "import type { PropArt } from './propArt';",
    "",
    "const T = '/props/spajx';",
    "const M = '/props3d/spajx';",
    "",
    "const STEMS = [",
]
for s in stems:
    lines.append(f"  '{s}',")
lines += [
    "] as const;",
    "",
    "function prettyName(stem: string): string {",
    "  const raw = stem.replace(/^\\d+_/, '').replace(/_/g, ' ');",
    "  return raw.charAt(0).toUpperCase() + raw.slice(1);",
    "}",
    "",
    "export const SPAJX_PROP_ART: PropArt[] = STEMS.map((stem) => {",
    "  const pretty = prettyName(stem);",
    "  return {",
    "    id: `spajx-${stem.replace(/^\\d+_/, '').replace(/_/g, '-')}`,",
    "    name: pretty,",
    "    short: pretty.replace(/ (chest|coffer|trunk|case|vault|strongbox|footlocker)$/i, ''),",
    "    motion: 'none',",
    "    play: 'still',",
    "    rest: `${T}/${stem}.png`,",
    "  };",
    "});",
    "",
    "export const SPAJX_PROP_MODELS: Record<string, { url: string; sizeBias?: number }> =",
    "  Object.fromEntries(",
    "    SPAJX_PROP_ART.map((art, i) => [art.id, { url: `${M}/${STEMS[i]}.glb`, sizeBias: 0.95 }]),",
    "  );",
    "",
    "export const SPAJX_CREDIT =",
    "  '50 3D chests by spajx123c (itch.io) · personal use, not redistributed';",
    "",
]
out.write_text("\n".join(lines), encoding="utf-8")
print("wrote", len(stems))
