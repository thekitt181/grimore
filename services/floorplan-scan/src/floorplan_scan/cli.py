"""CLI: read JSON from stdin, write scan JSON to stdout."""

from __future__ import annotations

import base64
import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "empty stdin"}), file=sys.stderr)
        sys.exit(1)

    req = json.loads(raw)
    image_b64 = req.get("imageBase64")
    if not image_b64:
        print(json.dumps({"error": "imageBase64 required"}), file=sys.stderr)
        sys.exit(1)

    png_bytes = base64.b64decode(image_b64)
    map_w = int(req.get("width", 0))
    map_h = int(req.get("height", 0))
    grid_size = int(req.get("gridSize", 70))
    grid_offset_x = int(req.get("gridOffsetX", 0))
    grid_offset_y = int(req.get("gridOffsetY", 0))

    if map_w < 8 or map_h < 8:
        print(json.dumps({"error": "invalid map dimensions"}), file=sys.stderr)
        sys.exit(1)

    try:
        from floorplan_scan.png_scan import PngFloorplanScanner

        scanner = PngFloorplanScanner.shared()
        result = scanner.scan_grid(
            png_bytes,
            map_w,
            map_h,
            grid_size,
            grid_offset_x,
            grid_offset_y,
        )
        json.dump(result, sys.stdout)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
