import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  buildSceneFromWalkableGrid,
  scanMapImageFromPixelData,
  type MapSceneScanResult,
  type MapScanInput,
  type ScannedDoor,
} from '@grimoire/shared';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const WEIGHTS_DIR = path.join(REPO_ROOT, 'services', 'floorplan-scan', 'weights');
const PYTHON_MODULE = 'floorplan_scan.cli';

export type FloorplanScanRequest = MapScanInput & {
  imageBase64: string;
  threshold?: number;
};

type PythonGridResponse = {
  method?: string;
  cols: number;
  rows: number;
  walkable: number[];
  doorCells?: number[];
  error?: string;
};

let floorplanAvailable: boolean | null = null;

function weightsReady(): boolean {
  return (
    fs.existsSync(path.join(WEIGHTS_DIR, 'config.yaml')) &&
    fs.existsSync(path.join(WEIGHTS_DIR, 'best.safetensors'))
  );
}

export function isFloorplanScanConfigured(): boolean {
  if (process.env['FLOORPLAN_SCAN_URL']) return true;
  if (!weightsReady()) return false;
  if (floorplanAvailable === false) return false;
  return true;
}

async function fetchImageBase64(backgroundUrl: string): Promise<{ base64: string; buffer: Buffer }> {
  let buffer: Buffer;
  if (backgroundUrl.startsWith('data:')) {
    const comma = backgroundUrl.indexOf(',');
    buffer = Buffer.from(backgroundUrl.slice(comma + 1), 'base64');
  } else {
    const res = await fetch(backgroundUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Failed to fetch map image: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  return { base64: buffer.toString('base64'), buffer };
}

async function runPythonScan(req: FloorplanScanRequest): Promise<PythonGridResponse> {
  const python = process.env['FLOORPLAN_PYTHON'] ?? 'python';
  const payload = JSON.stringify({
    imageBase64: req.imageBase64,
    width: req.width,
    height: req.height,
    gridSize: req.gridSize,
    gridOffsetX: req.gridOffsetX,
    gridOffsetY: req.gridOffsetY,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', PYTHON_MODULE], {
      cwd: path.join(REPO_ROOT, 'services', 'floorplan-scan'),
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(REPO_ROOT, 'services', 'floorplan-scan', 'src'),
          path.join(REPO_ROOT, 'services', 'floorplan-to-3d-ref', 'src'),
        ].join(path.delimiter),
        FLOORPLAN_WEIGHTS_DIR: WEIGHTS_DIR,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        floorplanAvailable = false;
        reject(new Error(stderr.trim() || stdout.trim() || `python exit ${code}`));
        return;
      }
      try {
        floorplanAvailable = true;
        resolve(JSON.parse(stdout) as PythonGridResponse);
      } catch {
        reject(new Error(`Invalid python output: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function runRemoteScan(req: FloorplanScanRequest): Promise<PythonGridResponse> {
  const url = `${process.env['FLOORPLAN_SCAN_URL']!.replace(/\/$/, '')}/scan`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: req.imageBase64,
      width: req.width,
      height: req.height,
      gridSize: req.gridSize,
      gridOffsetX: req.gridOffsetX,
      gridOffsetY: req.gridOffsetY,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Floorplan service ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as PythonGridResponse;
}

async function cvScanFromBuffer(
  map: MapScanInput,
  imageBuffer: Buffer,
  threshold: number,
): Promise<MapSceneScanResult> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const maxDim = 2800;
  const scale = Math.min(1, maxDim / Math.max(map.width, map.height));
  const sampleW = Math.max(32, Math.round(map.width * scale));
  const sampleH = Math.max(32, Math.round(map.height * scale));

  let scaled = pixels;
  let w = info.width;
  let h = info.height;
  if (sampleW !== w || sampleH !== h) {
    const resized = await sharp(imageBuffer)
      .resize(sampleW, sampleH, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    scaled = new Uint8ClampedArray(resized.data.buffer, resized.data.byteOffset, resized.data.byteLength);
    w = resized.info.width;
    h = resized.info.height;
  }

  return scanMapImageFromPixelData(map, scaled, w, h, { threshold });
}

function mergeDoors(primary: ScannedDoor[], extra: ScannedDoor[]): ScannedDoor[] {
  if (extra.length === 0) return primary;
  const merged = [...primary];
  const seen = new Set(primary.map((d) => `${Math.round(d.cx)}:${Math.round(d.cz)}:${d.rotation}`));
  for (const door of extra) {
    const key = `${Math.round(door.cx)}:${Math.round(door.cz)}:${door.rotation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...door, id: `door-ai-${merged.length}` });
  }
  return merged;
}

export type FloorplanScanMeta = {
  method: 'cubicasa' | 'cv';
  aiDoors?: number;
};

export async function scanMapFloorplan(
  map: MapScanInput & { backgroundUrl: string },
  threshold = 64,
): Promise<{ scene: MapSceneScanResult; meta: FloorplanScanMeta }> {
  const { base64, buffer } = await fetchImageBase64(map.backgroundUrl);
  const req: FloorplanScanRequest = { ...map, imageBase64: base64, threshold };

  const scene = await cvScanFromBuffer(map, buffer, threshold);
  const tryRemote = Boolean(process.env['FLOORPLAN_SCAN_URL']);
  const tryLocal = weightsReady();

  if (!(tryRemote || tryLocal)) {
    return { scene, meta: { method: 'cv' } };
  }

  try {
    const grid = tryRemote ? await runRemoteScan(req) : await runPythonScan(req);
    if (grid.error) throw new Error(grid.error);
    const aiScene = buildSceneFromWalkableGrid(map, grid.cols, grid.rows, grid.walkable);
    const doors = mergeDoors(scene.doors, aiScene.doors);
    return {
      scene: {
        ...scene,
        doors,
        featureCount: scene.wallSegments.length + doors.length,
      },
      meta: { method: 'cubicasa', aiDoors: aiScene.doors.length },
    };
  } catch (err) {
    console.warn('[Floorplan] CubiCasa UNet pass failed — CV walls only:', err);
    return { scene, meta: { method: 'cv' } };
  }
}
