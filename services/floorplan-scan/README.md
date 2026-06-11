# Floorplan scan (CubiCasa UNet)

Grimoire uses the [floorplan-to-3d](https://github.com/Yytsi/floorplan-to-3d) ResNet-UNet to segment battle maps into wall / door / floor classes, then extrudes clean grid-aligned walls in Three.js.

## One-time setup

```bash
# Weights (~90 MB)
node scripts/download-floorplan-weights.mjs

# Python deps (CPU torch is fine)
pip install -e services/floorplan-scan
```

The vendored model code lives in `services/floorplan-to-3d-ref/` (clone of floorplan-to-3d).

## Local dev

The Node server spawns `python -m floorplan_scan.cli` when weights are present. Set `FLOORPLAN_PYTHON=py` on Windows if needed.

Optional standalone service (for Render split deploy):

```bash
pip install -e "services/floorplan-scan[serve]"
FLOORPLAN_WEIGHTS_DIR=services/floorplan-scan/weights uvicorn floorplan_scan.server:app --port 8010
```

Then set `FLOORPLAN_SCAN_URL=http://localhost:8010` on the Node server.

## API

`POST /api/maps/floorplan-scan` — body: map dimensions + `backgroundUrl`. Returns wall segments and doors. Falls back to client-side CV if Python/weights are unavailable.
