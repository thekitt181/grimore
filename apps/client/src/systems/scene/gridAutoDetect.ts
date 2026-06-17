/**
 * Detect printed square-grid spacing + origin from a map image by analysing
 * edge energy along rows/columns. Works best on maps with visible grid lines.
 */

export interface GridDetection {
  gridSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
  confidence: number; // 0–1
}

const MAX_SAMPLE = 900;
const MIN_CELL = 20;
const MAX_CELL_RATIO = 0.45; // max cell = 45% of map width
const MAX_CELLS_ACROSS = 60;  // floor cell size so detection can't return a tiny dense grid

/** Load image into a canvas (CORS-safe). Returns null if pixels are unreadable. */
async function loadSampleCanvas(
  url: string,
  targetW: number,
  targetH: number,
): Promise<{ canvas: HTMLCanvasElement; scale: number } | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Image load failed'));
    el.src = url;
  });

  const scale = Math.min(1, MAX_SAMPLE / Math.max(targetW, targetH));
  const w = Math.max(32, Math.round(targetW * scale));
  const h = Math.max(32, Math.round(targetH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  try {
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    return null; // tainted canvas — CORS blocked
  }
  return { canvas, scale };
}

function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

/** Horizontal + vertical edge energy projected onto each axis. */
function axisProfiles(data: Uint8ClampedArray, w: number, h: number) {
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const l = luminance(data, i);
      const lx = Math.abs(l - luminance(data, i - 4));
      const ly = Math.abs(l - luminance(data, i - w * 4));
      cols[x]! += lx;
      rows[y]! += ly;
    }
  }
  return { cols, rows };
}

function smooth(signal: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    let sum = 0, n = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j >= 0 && j < signal.length) { sum += signal[j]!; n++; }
    }
    out[i] = sum / n;
  }
  return out;
}

/** Find dominant spacing via autocorrelation peak in [minLag, maxLag]. */
function detectPeriod(signal: Float32Array, minLag: number, maxLag: number): { period: number; strength: number } {
  let bestLag = minLag;
  let bestScore = -Infinity;
  let baseline = 0;
  for (let i = 0; i < signal.length; i++) baseline += signal[i]!;
  baseline /= signal.length || 1;

  for (let lag = minLag; lag <= Math.min(maxLag, signal.length - 1); lag++) {
    let sum = 0, count = 0;
    for (let i = 0; i < signal.length - lag; i++) {
      sum += (signal[i]! - baseline) * (signal[i + lag]! - baseline);
      count++;
    }
    const score = sum / (count || 1);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const norm = signal.reduce((a, v) => a + v * v, 0) / signal.length;
  const strength = norm > 0 ? Math.max(0, bestScore / norm) : 0;
  return { period: bestLag, strength };
}

function findPeaksList(signal: Float32Array, minDist: number): number[] {
  let max = 0;
  for (const v of signal) max = Math.max(max, v);
  const thresh = max * 0.22;
  const peaks: number[] = [];
  for (let i = 2; i < signal.length - 2; i++) {
    const v = signal[i]!;
    if (
      v > thresh &&
      v >= signal[i - 1]! && v >= signal[i + 1]! &&
      v >= signal[i - 2]! && v >= signal[i + 2]!
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1]! >= minDist * 0.6) peaks.push(i);
    }
  }
  return peaks;
}

function medianInterval(peaks: number[]): number | null {
  if (peaks.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i]! - peaks[i - 1]!);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/** First strong peak position (grid-line origin along an axis). */
function firstPeak(signal: Float32Array, peaks: number[], period: number): number {
  if (peaks.length > 0) return peaks[0]!;
  let max = 0;
  for (const v of signal) max = Math.max(max, v);
  const thresh = max * 0.35;
  const end = Math.min(signal.length, period * 2);
  let best = 0, bestVal = 0;
  for (let i = 1; i < end - 1; i++) {
    const v = signal[i]!;
    if (v > thresh && v >= signal[i - 1]! && v >= signal[i + 1]! && v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

function resolvePeriod(
  signal: Float32Array,
  minLag: number,
  maxLag: number,
): { period: number; strength: number; peaks: number[] } {
  const ac = detectPeriod(signal, minLag, maxLag);
  const peaks = findPeaksList(signal, minLag);
  const med = medianInterval(peaks);
  if (med !== null && peaks.length >= 4) {
    const diff = Math.abs(med - ac.period) / ac.period;
    const period = diff < 0.15 ? Math.round((med + ac.period) / 2) : med;
    return { period, strength: ac.strength + 0.15, peaks };
  }
  return { ...ac, peaks };
}

/**
 * Analyse a map image and return grid cell size + offset in *map pixel* space.
 * Returns null when detection fails (no image, CORS, or low confidence).
 */
export async function detectGridFromImage(
  imageUrl: string,
  mapWidth: number,
  mapHeight: number,
): Promise<GridDetection | null> {
  if (!imageUrl) return null;

  const sample = await loadSampleCanvas(imageUrl, mapWidth, mapHeight).catch(() => null);
  if (!sample) return null;

  const { canvas, scale } = sample;
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);

  const { cols, rows } = axisProfiles(data, w, h);
  const colS = smooth(cols, 2);
  const rowS = smooth(rows, 2);

  const invScale = 1 / scale;
  // Floor the cell size: a real battlemap is rarely more than ~60 cells across,
  // so this stops the detector locking onto fine texture/harmonics and returning
  // a tiny grid full of small squares.
  const minCellMapPx = Math.max(MIN_CELL, Math.max(mapWidth, mapHeight) / MAX_CELLS_ACROSS);
  const minLag = Math.max(3, Math.round(minCellMapPx * scale));
  const maxLagX = Math.round(w * MAX_CELL_RATIO);
  const maxLagY = Math.round(h * MAX_CELL_RATIO);

  const cx = resolvePeriod(colS, minLag, maxLagX);
  const cy = resolvePeriod(rowS, minLag, maxLagY);

  const confidence = Math.min(1, (cx.strength + cy.strength) * 2.2);
  if (confidence < 0.08) return null;

  const gridSize = Math.round(((cx.period + cy.period) / 2) * invScale);
  const clampedSize = Math.max(
    minCellMapPx,
    Math.min(Math.round(mapWidth * MAX_CELL_RATIO), gridSize),
  );

  const offXSample = firstPeak(colS, cx.peaks, cx.period);
  const offYSample = firstPeak(rowS, cy.peaks, cy.period);
  const rawOffX = Math.round(offXSample * invScale);
  const rawOffY = Math.round(offYSample * invScale);
  const gridOffsetX = ((rawOffX % clampedSize) + clampedSize) % clampedSize;
  const gridOffsetY = ((rawOffY % clampedSize) + clampedSize) % clampedSize;

  return { gridSize: clampedSize, gridOffsetX, gridOffsetY, confidence };
}
