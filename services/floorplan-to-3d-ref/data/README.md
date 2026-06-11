# data/

Datasets live here. Everything in this directory except this README is gitignored.

## CubiCasa5K

Download from https://zenodo.org/records/2613548 — direct link is `cubicasa5k.zip` (~3 GB).

Expected layout after extraction:

```
data/cubicasa5k/
  colorful/
  high_quality/
  high_quality_architectural/
  train.txt
  val.txt
  test.txt
```

The `*.txt` files list relative paths (one per line) into the three quality buckets. Each sample directory contains `F1_original.png` (the floor plan) and `model.svg` (the annotation).
