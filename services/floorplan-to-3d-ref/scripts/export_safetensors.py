"""Export a training .pt checkpoint to inference-only .safetensors.

Strips optimizer state and stashes epoch + best_miou in the safetensors
metadata header. The resulting file is what we upload to Hugging Face — no
pickle, ~1/3 the size of the training .pt, loads byte-identical weights.

Run:
    .venv/bin/python scripts/export_safetensors.py \\
        --src runs/<timestamp>/best.pt \\
        --out weights/best.safetensors
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from safetensors.torch import save_file


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True, type=Path, help="training checkpoint (.pt)")
    p.add_argument("--out", required=True, type=Path, help="output .safetensors path")
    args = p.parse_args()

    ckpt = torch.load(args.src, map_location="cpu", weights_only=False)
    state = ckpt["model"]

    # safetensors stores raw tensor bytes — non-contiguous views break the
    # zero-copy load. Force contiguity to be safe.
    state = {k: v.contiguous() for k, v in state.items()}

    # Metadata is str→str. We stash anything inference cares about; the
    # optimizer state and cfg dict are dropped (cfg lives next to the file
    # as config.yaml).
    metadata: dict[str, str] = {"format": "pt"}
    if "epoch" in ckpt:
        metadata["epoch"] = str(ckpt["epoch"])
    if "best_miou" in ckpt:
        metadata["best_miou"] = f"{ckpt['best_miou']:.6f}"

    args.out.parent.mkdir(parents=True, exist_ok=True)
    save_file(state, str(args.out), metadata=metadata)

    src_mb = args.src.stat().st_size / 1e6
    out_mb = args.out.stat().st_size / 1e6
    print(f"{args.src} ({src_mb:.1f} MB) -> {args.out} ({out_mb:.1f} MB)")
    print(f"metadata: {metadata}")


if __name__ == "__main__":
    main()
