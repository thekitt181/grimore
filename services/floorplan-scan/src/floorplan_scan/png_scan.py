"""Run CubiCasa UNet on raster battle maps (PNG/JPEG) and emit a grid walkable mask."""

from __future__ import annotations

import os
import sys
from io import BytesIO
from math import ceil
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

# buildingcv lives in the vendored floorplan-to-3d reference tree.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_BUILDINGCV_SRC = _REPO_ROOT / "floorplan-to-3d-ref" / "src"
if str(_BUILDINGCV_SRC) not in sys.path:
    sys.path.insert(0, str(_BUILDINGCV_SRC))

from buildingcv.checkpoint import load_inference_checkpoint  # noqa: E402
from buildingcv.labels import CLASS_TO_ID, FLOOR_ID  # noqa: E402
from buildingcv.model import build_model  # noqa: E402

DOOR_ID = CLASS_TO_ID["door"]
WALL_ID = CLASS_TO_ID["wall"]
WINDOW_ID = CLASS_TO_ID["window"]

DEFAULT_WEIGHTS_DIR = Path(__file__).resolve().parents[2] / "weights"
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def _resolve_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _letterbox_tensor(
    img_rgb: np.ndarray,
    image_size: tuple[int, int],
    normalize: bool,
) -> tuple[torch.Tensor, tuple[int, int, int, int]]:
    """Resize RGB uint8 image into model input with aspect-preserving letterbox."""
    H, W = image_size
    orig_h, orig_w = img_rgb.shape[:2]
    scale = min(W / orig_w, H / orig_h)
    inner_w = max(1, int(round(orig_w * scale)))
    inner_h = max(1, int(round(orig_h * scale)))

    resized = cv2.resize(img_rgb, (inner_w, inner_h), interpolation=cv2.INTER_AREA)
    image_t = torch.from_numpy(resized).permute(2, 0, 1).contiguous().float().div_(255.0)

    if (inner_h, inner_w) == (H, W):
        left, top = 0, 0
        canvas = image_t
    else:
        top = (H - inner_h) // 2
        left = (W - inner_w) // 2
        if normalize:
            canvas = torch.zeros(3, H, W)
        else:
            mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
            canvas = mean.expand(3, H, W).clone()
        canvas[:, top : top + inner_h, left : left + inner_w] = image_t
        image_t = canvas

    if normalize:
        mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
        std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
        image_t = (image_t - mean) / std

    return image_t, (left, top, inner_w, inner_h)


def _mask_to_map_size(
    mask: np.ndarray,
    content_rect: tuple[int, int, int, int],
    map_w: int,
    map_h: int,
) -> np.ndarray:
    left, top, inner_w, inner_h = content_rect
    inner = mask[top : top + inner_h, left : left + inner_w]
    return cv2.resize(inner, (map_w, map_h), interpolation=cv2.INTER_NEAREST)


def _mask_to_map_size(
    mask: np.ndarray,
    content_rect: tuple[int, int, int, int],
    map_w: int,
    map_h: int,
) -> np.ndarray:
    left, top, inner_w, inner_h = content_rect
    inner = mask[top : top + inner_h, left : left + inner_w]
    return cv2.resize(inner, (map_w, map_h), interpolation=cv2.INTER_NEAREST)


def _luminance(rgb: np.ndarray) -> np.ndarray:
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    return 0.299 * r + 0.587 * g + 0.114 * b


def _cell_stats(patch: np.ndarray) -> dict:
    lum = _luminance(patch)
    r = patch[..., 0].astype(np.float32).mean()
    g = patch[..., 1].astype(np.float32).mean()
    b = patch[..., 2].astype(np.float32).mean()
    avg_lum = float(lum.mean())
    dark_ratio = float((lum < 58).mean())
    return {"r": r, "g": g, "b": b, "lum": avg_lum, "dark_ratio": dark_ratio}


def _is_ambient_glow(st: dict) -> bool:
    if st["r"] > st["g"] + 18 and st["r"] > st["b"] + 14 and 45 < st["lum"] < 220:
        return True
    if st["r"] > 120 and st["g"] < st["r"] * 0.72 and st["b"] < st["r"] * 0.55 and st["lum"] > 40:
        return True
    return False


def _is_parchment(st: dict) -> bool:
    return st["lum"] > 158 and st["dark_ratio"] < 0.22 and st["r"] > st["b"] + 4 and st["g"] > st["b"]


def _is_door_tone(st: dict) -> bool:
    return (
        st["r"] > 130
        and st["g"] > 105
        and st["b"] > 65
        and 95 < st["lum"] < 205
        and st["dark_ratio"] < 0.38
    )


def _is_cv_wall(st: dict, threshold: float = 64, dark_ratio: float = 0.52) -> bool:
    if _is_ambient_glow(st) or _is_parchment(st) or _is_door_tone(st):
        return False
    if st["lum"] < 42 and st["dark_ratio"] >= 0.35:
        return True
    if st["lum"] < threshold and st["dark_ratio"] >= dark_ratio:
        return True
    return False


def _remove_enclosed_voids(wall_mask: np.ndarray, cols: int, rows: int) -> np.ndarray:
    out = wall_mask.copy()
    visited = np.zeros((rows, cols), dtype=np.uint8)
    stack: list[tuple[int, int]] = []

    for x in range(cols):
        stack.append((x, 0))
        stack.append((x, rows - 1))
    for y in range(1, rows - 1):
        stack.append((0, y))
        stack.append((cols - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= cols or y >= rows:
            continue
        if visited[y, x] or wall_mask[y, x]:
            continue
        visited[y, x] = 1
        stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    for y in range(1, rows - 1):
        for x in range(1, cols - 1):
            if not wall_mask[y, x] or visited[y, x]:
                continue
            touches_open = False
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= cols or ny >= rows:
                        continue
                    if not wall_mask[ny, nx] and visited[ny, nx]:
                        touches_open = True
                        break
                if touches_open:
                    break
            if not touches_open:
                out[y, x] = 0
    return out


def _build_cv_walkable_grid(
    img_rgb: np.ndarray,
    map_w: int,
    map_h: int,
    grid_size: int,
    grid_offset_x: int,
    grid_offset_y: int,
    threshold: float = 64,
    dark_ratio_min: float = 0.52,
) -> tuple[np.ndarray, np.ndarray]:
    """Battle-map wall grid — mirrors Grimoire client CV scan."""
    cols = max(1, ceil(map_w / grid_size))
    rows = max(1, ceil(map_h / grid_size))
    wall_mask = np.zeros((rows, cols), dtype=np.uint8)
    door_cells = np.zeros((rows, cols), dtype=np.uint8)

    max_dim = 2800
    scale = min(1.0, max_dim / max(map_w, map_h))
    scaled_grid = max(4, int(round(grid_size * scale)))
    scaled_ox = int(round(grid_offset_x * scale))
    scaled_oy = int(round(grid_offset_y * scale))
    sample = img_rgb
    if scale < 1.0:
        sample = cv2.resize(img_rgb, (max(32, int(round(map_w * scale))), max(32, int(round(map_h * scale)))), interpolation=cv2.INTER_AREA)
    sample_h, sample_w = sample.shape[:2]

    for cy in range(rows):
        for cx in range(cols):
            x0 = min(sample_w - 1, max(0, scaled_ox + cx * scaled_grid))
            y0 = min(sample_h - 1, max(0, scaled_oy + cy * scaled_grid))
            x1 = min(sample_w, x0 + scaled_grid)
            y1 = min(sample_h, y0 + scaled_grid)
            patch = sample[y0:y1, x0:x1]
            if patch.size == 0:
                continue
            st = _cell_stats(patch)
            if _is_door_tone(st):
                door_cells[cy, cx] = 1
            if _is_cv_wall(st, threshold, dark_ratio_min):
                wall_mask[cy, cx] = 1

    # Drop isolated wall speckles (same as client removeIsolatedWallCells).
    for y in range(rows):
        for x in range(cols):
            if not wall_mask[y, x]:
                continue
            n = 0
            if x > 0 and wall_mask[y, x - 1]:
                n += 1
            if x < cols - 1 and wall_mask[y, x + 1]:
                n += 1
            if y > 0 and wall_mask[y - 1, x]:
                n += 1
            if y < rows - 1 and wall_mask[y + 1, x]:
                n += 1
            if n == 0:
                wall_mask[y, x] = 0

    wall_mask = _remove_enclosed_voids(wall_mask, cols, rows)

    walkable = np.ones((rows, cols), dtype=np.uint8)
    for cy in range(rows):
        for cx in range(cols):
            x0 = min(map_w - 1, max(0, grid_offset_x + cx * grid_size))
            y0 = min(map_h - 1, max(0, grid_offset_y + cy * grid_size))
            x1 = min(map_w, x0 + grid_size)
            y1 = min(map_h, y0 + grid_size)
            st = _cell_stats(img_rgb[y0:y1, x0:x1])
            if wall_mask[cy, cx]:
                walkable[cy, cx] = 0
            elif _is_parchment(st):
                walkable[cy, cx] = 0
            elif door_cells[cy, cx]:
                walkable[cy, cx] = 1
            else:
                walkable[cy, cx] = 1

    return walkable, door_cells


def _apply_model_doors(
    walkable: np.ndarray,
    door_cells: np.ndarray,
    class_mask: np.ndarray,
    map_w: int,
    map_h: int,
    grid_size: int,
    grid_offset_x: int,
    grid_offset_y: int,
) -> None:
    """Use CubiCasa door class to punch walkable openings in wall edges."""
    rows, cols = walkable.shape
    for cy in range(rows):
        for cx in range(cols):
            x0 = min(map_w - 1, max(0, grid_offset_x + cx * grid_size))
            y0 = min(map_h - 1, max(0, grid_offset_y + cy * grid_size))
            x1 = min(map_w, x0 + grid_size)
            y1 = min(map_h, y0 + grid_size)
            patch = class_mask[y0:y1, x0:x1]
            if patch.size == 0:
                continue
            door_ratio = float((patch == DOOR_ID).mean())
            if door_ratio >= 0.05:
                walkable[cy, cx] = 1
                door_cells[cy, cx] = 1


class PngFloorplanScanner:
    """Loads CubiCasa weights once, scans many PNG battle maps."""

    _shared: PngFloorplanScanner | None = None

    def __init__(
        self,
        weights_dir: Path | None = None,
        ckpt: str = "best.safetensors",
        device: str = "auto",
    ) -> None:
        import yaml

        run_dir = Path(weights_dir or os.environ.get("FLOORPLAN_WEIGHTS_DIR", DEFAULT_WEIGHTS_DIR))
        cfg_path = run_dir / "config.yaml"
        ckpt_path = run_dir / ckpt
        if not cfg_path.is_file() or not ckpt_path.is_file():
            raise FileNotFoundError(
                f"Floorplan weights missing at {run_dir}. "
                "Run: node scripts/download-floorplan-weights.mjs"
            )

        with cfg_path.open() as f:
            self.cfg = yaml.safe_load(f)

        self.device = _resolve_device(device)
        self.image_size: tuple[int, int] = tuple(self.cfg["data"]["image_size"])
        self.letterbox: bool = self.cfg["data"].get("letterbox", True)
        self.normalize: bool = self.cfg["data"]["normalize"]

        self.model = build_model(
            encoder_name=self.cfg["model"]["encoder_name"],
            encoder_weights=None,
        ).to(self.device)
        state, self.epoch = load_inference_checkpoint(ckpt_path, self.device)
        self.model.load_state_dict(state)
        self.model.eval()

    @classmethod
    def shared(cls) -> PngFloorplanScanner:
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @torch.no_grad()
    def predict_class_mask(self, png_bytes: bytes) -> tuple[np.ndarray, tuple[int, int, int, int]]:
        img = Image.open(BytesIO(png_bytes)).convert("RGB")
        arr = np.array(img)
        image_t, rect = _letterbox_tensor(arr, self.image_size, self.normalize)
        logits = self.model(image_t.unsqueeze(0).to(self.device))
        mask = logits.argmax(dim=1).squeeze(0).to("cpu", torch.uint8).numpy()

        left, top, inner_w, inner_h = rect
        if (inner_h, inner_w) != mask.shape:
            cleaned = np.full_like(mask, FLOOR_ID)
            cleaned[top : top + inner_h, left : left + inner_w] = mask[
                top : top + inner_h, left : left + inner_w
            ]
            mask = cleaned
        return mask, rect

    def scan_grid(
        self,
        png_bytes: bytes,
        map_w: int,
        map_h: int,
        grid_size: int,
        grid_offset_x: int = 0,
        grid_offset_y: int = 0,
    ) -> dict:
        img = Image.open(BytesIO(png_bytes)).convert("RGB")
        img_rgb = np.array(img)
        if img_rgb.shape[1] != map_w or img_rgb.shape[0] != map_h:
            img_rgb = cv2.resize(img_rgb, (map_w, map_h), interpolation=cv2.INTER_AREA)

        mask, rect = self.predict_class_mask(png_bytes)
        map_mask = _mask_to_map_size(mask, rect, map_w, map_h)
        walkable, door_cells = _build_cv_walkable_grid(
            img_rgb, map_w, map_h, grid_size, grid_offset_x, grid_offset_y
        )
        _apply_model_doors(
            walkable, door_cells, map_mask, map_w, map_h, grid_size, grid_offset_x, grid_offset_y
        )
        # Tan door swatches from battle map art.
        rows, cols = walkable.shape
        for cy in range(rows):
            for cx in range(cols):
                if not door_cells[cy, cx]:
                    continue
                walkable[cy, cx] = 1
        cols = walkable.shape[1]
        rows = walkable.shape[0]
        return {
            "method": "cubicasa",
            "cols": cols,
            "rows": rows,
            "walkable": walkable.reshape(-1).astype(int).tolist(),
            "doorCells": door_cells.reshape(-1).astype(int).tolist(),
            "epoch": self.epoch,
            "device": str(self.device),
        }
