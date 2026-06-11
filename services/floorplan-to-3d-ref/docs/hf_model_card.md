---
license: mit
library_name: pytorch
pipeline_tag: image-segmentation
metrics:
  - mean_iou
tags:
  - segmentation
  - unet
  - resnet
  - floor-plan
  - cubicasa5k
model-index:
  - name: floorplan-to-3d-walls
    results:
      - task:
          type: image-segmentation
          name: Semantic Segmentation
        dataset:
          type: cubicasa5k
          name: CubiCasa5K
        metrics:
          - type: mean_iou
            value: 0.983
            name: Validation mIoU (4 classes)
---

# Floorplan to 3D — segmentation model

A UNet decoder with a ResNet-34 encoder backbone (ImageNet-pretrained),
trained on [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) to segment
architectural floor plans into four classes:
**floor / wall / door / window**.

The full project (training code, polygon extractor, FastAPI inference server,
3D Three.js viewer) lives at **https://github.com/Yytsi/floorplan-to-3d**.

A hosted preview at [floorplan-to-3d.pages.dev](https://floorplan-to-3d.pages.dev)
shows three pre-rendered example plans extruded into 3D — it's static, no
backend. To run inference on your own SVGs, clone the repo and start the
local FastAPI server (the viewer detects it via `/healthz` and reveals an
upload button).

## Files

- `best.safetensors` — model weights, ~98 MB. Loadable with
  `safetensors.torch.load_file`. The `epoch` and `best_miou` are stored in
  the safetensors metadata header.
- `config.yaml` — training config required by the loader (image size,
  letterbox, normalization, encoder name).

## Quick start

```bash
mkdir -p weights
curl -L -o weights/best.safetensors https://huggingface.co/Yytsi/floorplan-to-3d-walls/resolve/main/best.safetensors
curl -L -o weights/config.yaml      https://huggingface.co/Yytsi/floorplan-to-3d-walls/resolve/main/config.yaml
```

Then follow the README on GitHub for the inference server + viewer.

## Training

- **Data:** CubiCasa5K (high-quality + high-quality-architectural splits).
- **Input:** 512×512 RGB, aspect-preserving letterbox so non-square plans
  aren't stretched. ImageNet-mean fill in the padding.
- **Encoder:** ResNet-34 pretrained on ImageNet.
- **Loss:** cross-entropy.
- **Best val mIoU:** 0.983 at epoch 26.

## Limitations

- CubiCasa5K is dominated by Nordic residential plans drawn in a specific
  CAD style. The model generalizes well within that distribution but may
  miss elements on hand-drawn sketches, commercial blueprints, or plans
  using very different line conventions.
- Only the four structural classes above are predicted. Furniture, fixtures,
  and text annotations are treated as floor.
- Input is rasterized from SVG at 512×512; very long thin walls in oversized
  plans can get sub-pixel and be missed.

## License

MIT — see the [GitHub repo](https://github.com/Yytsi/floorplan-to-3d/blob/main/LICENSE).
