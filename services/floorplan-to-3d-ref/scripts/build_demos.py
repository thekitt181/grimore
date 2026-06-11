"""Pre-render the viewer's sample plans into static JSON.

The deployed Pages site has no backend, so the "Try a sample" buttons load
JSON files from `viewer/demos/` instead of hitting the FastAPI server. This
script regenerates those JSONs from the current weights — re-run it after
the model improves (export with `scripts/export_safetensors.py` first).

Run:
    .venv/bin/python scripts/build_demos.py
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import cairosvg

from buildingcv.extract_polygons import PolygonExtractor
from buildingcv.svg_render import filtered_svg_bytes

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RUN_DIR = REPO_ROOT / "weights"
DATA_DIR = Path(os.environ.get("BUILDINGCV_DATA_DIR", REPO_ROOT / "data" / "cubicasa5k"))
OUT_DIR = REPO_ROOT / "viewer" / "demos"

# Same set the local server exposes — the static demos are a frozen mirror of
# those, so the viewer behaves identically online and offline.
SAMPLES: dict[str, str] = {
    "1191": "high_quality_architectural/1191",
    "4068": "high_quality_architectural/4068",
    "3676": "high_quality/3676",
}


def attach_input_image(svg_path: Path, result: dict) -> dict:
    _, _, inner_w, inner_h = result["content_rect"]
    png = cairosvg.svg2png(
        bytestring=filtered_svg_bytes(svg_path),
        output_width=inner_w,
        output_height=inner_h,
    )
    result["input_image_b64"] = base64.b64encode(png).decode("ascii")
    return result


def main() -> None:
    run_dir = Path(os.environ.get("BUILDINGCV_RUN_DIR", DEFAULT_RUN_DIR))
    extractor = PolygonExtractor(run_dir=run_dir, ckpt="best.safetensors", device="auto")
    print(f"loaded {run_dir}/best.safetensors on {extractor.device} (epoch {extractor.epoch})")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []

    for key, rel in SAMPLES.items():
        svg_path = DATA_DIR / rel / "model.svg"
        if not svg_path.exists():
            raise SystemExit(f"missing sample SVG: {svg_path}")
        result = attach_input_image(svg_path, extractor.extract(svg_path))
        out_path = OUT_DIR / f"{key}.json"
        out_path.write_text(json.dumps(result))
        size_kb = out_path.stat().st_size / 1024
        n_walls = len(result["polygons"]["wall"])
        n_doors = len(result["polygons"]["door"])
        n_windows = len(result["polygons"]["window"])
        print(f"  {key}: {n_walls}w {n_doors}d {n_windows}win  ({size_kb:.0f} KB)")
        manifest.append({"key": key, "walls": n_walls, "doors": n_doors, "windows": n_windows})

    (OUT_DIR / "manifest.json").write_text(json.dumps({"samples": manifest}))
    print(f"wrote {len(manifest)} demos to {OUT_DIR.relative_to(REPO_ROOT)}/")


if __name__ == "__main__":
    main()
