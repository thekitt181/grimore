import { create } from 'zustand';
import { normalizeDieSides } from './dieGeometry';

export type DieKind = 4 | 6 | 8 | 10 | 12 | 20;
export const DIE_KINDS: DieKind[] = [4, 6, 8, 10, 12, 20];

export interface DieSkin {
  /** Base material colour (used when no image is set, or tints the image). */
  color: string;
  /** Imported image data URL applied as a texture, or null for solid colour. */
  image: string | null;
}

export const DEFAULT_DIE_COLORS: Record<DieKind, string> = {
  20: '#8b1a1a',
  12: '#1a3a8b',
  10: '#2d6a4f',
  8: '#6b21a8',
  6: '#374151',
  4: '#92400e',
};

const STORAGE_KEY = 'grimoire.diceSkins.v1';
const FIT_KEY = 'grimoire.diceSkins.fit';
const DEFAULT_FIT = 0.7;

function loadFit(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_FIT;
  const raw = localStorage.getItem(FIT_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0.3 && n <= 1 ? n : DEFAULT_FIT;
}

function persistFit(fit: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FIT_KEY, String(fit));
  } catch {
    /* storage unavailable */
  }
}

function defaultSkins(): Record<DieKind, DieSkin> {
  return DIE_KINDS.reduce((acc, kind) => {
    acc[kind] = { color: DEFAULT_DIE_COLORS[kind], image: null };
    return acc;
  }, {} as Record<DieKind, DieSkin>);
}

function loadSkins(): Record<DieKind, DieSkin> {
  const base = defaultSkins();
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<DieKind, Partial<DieSkin>>>;
    for (const kind of DIE_KINDS) {
      const entry = parsed[kind];
      if (!entry) continue;
      base[kind] = {
        color: typeof entry.color === 'string' ? entry.color : base[kind].color,
        image: typeof entry.image === 'string' ? entry.image : null,
      };
    }
  } catch {
    return defaultSkins();
  }
  return base;
}

function persistSkins(skins: Record<DieKind, DieSkin>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skins));
  } catch {
    /* storage full / unavailable — skins stay in-memory for the session */
  }
}

interface DiceSkinState {
  skins: Record<DieKind, DieSkin>;
  /** How tightly imported images are zoomed/cropped onto faces (0.3–1). */
  imageFit: number;
  setImageFit: (fit: number) => void;
  setColor: (kind: DieKind, color: string) => void;
  setImage: (kind: DieKind, image: string | null) => void;
  /** Apply one image to every die (e.g. a dice-set photo). */
  setImageAll: (image: string | null) => void;
  /** Apply one colour to every die. */
  setColorAll: (color: string) => void;
  resetKind: (kind: DieKind) => void;
  resetAll: () => void;
  /** Resolve the skin for any die size (d100 → d10, odd sizes → nearest shape). */
  skinFor: (sides: number) => DieSkin;
}

export const useDiceSkinStore = create<DiceSkinState>((set, get) => ({
  skins: loadSkins(),
  imageFit: loadFit(),
  setImageFit: (fit) =>
    set(() => {
      const clamped = Math.max(0.3, Math.min(1, fit));
      persistFit(clamped);
      return { imageFit: clamped };
    }),
  setColor: (kind, color) =>
    set((s) => {
      const skins = { ...s.skins, [kind]: { ...s.skins[kind], color } };
      persistSkins(skins);
      return { skins };
    }),
  setImage: (kind, image) =>
    set((s) => {
      const skins = { ...s.skins, [kind]: { ...s.skins[kind], image } };
      persistSkins(skins);
      return { skins };
    }),
  setImageAll: (image) =>
    set((s) => {
      const skins = { ...s.skins };
      for (const kind of DIE_KINDS) skins[kind] = { ...skins[kind], image };
      persistSkins(skins);
      return { skins };
    }),
  setColorAll: (color) =>
    set((s) => {
      const skins = { ...s.skins };
      for (const kind of DIE_KINDS) skins[kind] = { ...skins[kind], color };
      persistSkins(skins);
      return { skins };
    }),
  resetKind: (kind) =>
    set((s) => {
      const skins = { ...s.skins, [kind]: { color: DEFAULT_DIE_COLORS[kind], image: null } };
      persistSkins(skins);
      return { skins };
    }),
  resetAll: () =>
    set(() => {
      const skins = defaultSkins();
      persistSkins(skins);
      return { skins };
    }),
  skinFor: (sides) => get().skins[normalizeDieSides(sides)],
}));

/**
 * Read an image File and return a downscaled PNG data URL suitable for storing
 * in localStorage. The plain-background crop happens later at render time (see
 * {@link buildDieTextureCanvas}) so it also fixes images saved before cropping
 * existed, without needing a re-import.
 */
export function fileToDiceSkinImage(file: File, maxDim = 1536): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // High-detail import, but JPEG-encoded so 7 dice fit in localStorage.
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bounding box of the non-background subject: pixels close to the corner colour
 * are treated as backdrop and excluded, so a die photographed on a plain surface
 * is cropped down to just the die.
 */
function trimUniformBackground(ctx: CanvasRenderingContext2D, w: number, h: number): CropBox {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const corners: Array<[number, number]> = [
      [0, 0],
      [w - 1, 0],
      [0, h - 1],
      [w - 1, h - 1],
    ];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const [cx, cy] of corners) {
      const i = (cy * w + cx) * 4;
      br += data[i]!;
      bg += data[i + 1]!;
      bb += data[i + 2]!;
    }
    br /= 4;
    bg /= 4;
    bb /= 4;

    const tol = 60;
    const isBg = (i: number): boolean =>
      Math.abs(data[i]! - br) <= tol &&
      Math.abs(data[i + 1]! - bg) <= tol &&
      Math.abs(data[i + 2]! - bb) <= tol;

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (!isBg((y * w + x) * 4)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return { x: 0, y: 0, w, h };

    const pad = Math.round(Math.min(w, h) * 0.02);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    if (cw >= w * 0.98 && ch >= h * 0.98) return { x: 0, y: 0, w, h };
    return { x: minX, y: minY, w: cw, h: ch };
  } catch {
    return { x: 0, y: 0, w, h };
  }
}

interface DiePalette {
  /** Dominant body colour (the die material). */
  body: string;
  /** Accent colour (the engraving / pattern). */
  accent: string;
}

function rgbToCss(r: number, g: number, b: number): string {
  const h = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function colorDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/**
 * Extract the die's two defining colours from the uploaded image: the dominant
 * body colour and the brighter accent (engraving) colour. The plain backdrop is
 * ignored by sampling the corner colour and excluding pixels close to it.
 */
export function extractDiePalette(img: HTMLImageElement): DiePalette {
  const fallback: DiePalette = { body: '#1b1b22', accent: '#c9a84c' };
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, n, n);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, n, n).data;
  } catch {
    return fallback;
  }

  const corners = [0, n - 1, (n - 1) * n, (n - 1) * n + (n - 1)];
  let br = 0;
  let bg = 0;
  let bb = 0;
  for (const c of corners) {
    br += data[c * 4]!;
    bg += data[c * 4 + 1]!;
    bb += data[c * 4 + 2]!;
  }
  const bgColor: [number, number, number] = [br / 4, bg / 4, bb / 4];

  const pixels: Array<{ r: number; g: number; b: number; l: number }> = [];
  for (let i = 0; i < n * n; i += 1) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    if (colorDist([r, g, b], bgColor) <= 70) continue;
    pixels.push({ r, g, b, l: 0.299 * r + 0.587 * g + 0.114 * b });
  }
  if (pixels.length < 8) return fallback;

  pixels.sort((a, b) => a.l - b.l);
  const avg = (
    arr: Array<{ r: number; g: number; b: number }>,
  ): [number, number, number] => {
    const s = arr.reduce(
      (acc, p) => {
        acc[0] += p.r;
        acc[1] += p.g;
        acc[2] += p.b;
        return acc;
      },
      [0, 0, 0] as [number, number, number],
    );
    return [s[0] / arr.length, s[1] / arr.length, s[2] / arr.length];
  };

  // Bias the body toward the true material colour (the darkest cluster) so an
  // ornate die with lots of bright engraving doesn't average out to grey.
  const darkCount = Math.max(1, Math.floor(pixels.length * 0.3));
  const brightCount = Math.max(1, Math.floor(pixels.length * 0.2));
  const bodyRgb = avg(pixels.slice(0, darkCount));
  let accentRgb = avg(pixels.slice(pixels.length - brightCount));

  // If body and accent are too similar, lift the accent so the pattern is visible.
  if (colorDist(bodyRgb, accentRgb) < 60) {
    accentRgb = [
      Math.min(255, bodyRgb[0] * 0.5 + 200),
      Math.min(255, bodyRgb[1] * 0.5 + 200),
      Math.min(255, bodyRgb[2] * 0.5 + 200),
    ];
  }

  return {
    body: rgbToCss(bodyRgb[0], bodyRgb[1], bodyRgb[2]),
    accent: rgbToCss(accentRgb[0], accentRgb[1], accentRgb[2]),
  };
}

interface SkinSource {
  work: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  body: string;
}

/** Prepare a cropped, zoomed source rectangle (the die's artwork patch) plus the
 *  body colour, ready to be drawn into one or more square cells. */
function computeSkinSource(img: HTMLImageElement, zoom: number): SkinSource | null {
  const workMax = 1600;
  const wscale = Math.min(1, workMax / Math.max(img.width, img.height, 1));
  const ww = Math.max(1, Math.round(img.width * wscale));
  const wh = Math.max(1, Math.round(img.height * wscale));
  const work = document.createElement('canvas');
  work.width = ww;
  work.height = wh;
  const wctx = work.getContext('2d');
  if (!wctx) return null;
  wctx.drawImage(img, 0, 0, ww, wh);

  const { body } = extractDiePalette(img);
  const crop = trimUniformBackground(wctx, ww, wh);

  let sx = crop.x;
  let sy = crop.y;
  let sw = crop.w;
  let sh = crop.h;
  if (crop.w > crop.h) {
    sw = crop.h;
    sx = crop.x + (crop.w - sw) / 2;
  } else if (crop.h > crop.w) {
    sh = crop.w;
    sy = crop.y + (crop.h - sh) / 2;
  }

  const z = Math.max(0.3, Math.min(1, zoom));
  sx += (sw * (1 - z)) / 2;
  sy += (sh * (1 - z)) / 2;
  sw *= z;
  sh *= z;

  return { work, sx, sy, sw, sh, body };
}

/**
 * Build a die-face texture from the uploaded image by cropping the plain backdrop
 * away and centre-fitting the die's real artwork into a square. Used for the live
 * preview swatch.
 */
export function buildDieTextureCanvas(
  img: HTMLImageElement,
  zoom = 0.7,
  size = 1536,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  if (!octx) return out;
  octx.imageSmoothingQuality = 'high';

  const src = computeSkinSource(img, zoom);
  if (!src) return out;
  octx.fillStyle = src.body;
  octx.fillRect(0, 0, size, size);
  octx.drawImage(src.work, src.sx, src.sy, src.sw, src.sh, 0, 0, size, size);
  return out;
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Build the face sheet by cropping the die's front (most fully-visible) face from the
 * photo and mapping it straight onto the die. On an angled product shot the front face
 * sits in the lower-centre of the foreground (below the top face), so we take a square
 * there. The geometry's per-face UVs then reshape this square into each die's faces.
 */
export function buildCleanFaceCanvas(
  img: HTMLImageElement,
  _zoom: number,
  size = 512,
): { canvas: HTMLCanvasElement; body: string } | null {
  const src = computeSkinSource(img, 1);
  if (!src) return null;
  const face = document.createElement('canvas');
  face.width = size;
  face.height = size;
  const fctx = face.getContext('2d');
  if (!fctx) return null;
  fctx.imageSmoothingQuality = 'high';

  // Square crop of the front face: a little smaller than the foreground and nudged
  // down so we land on the flat face artwork rather than the bevelled top/side edges.
  const base = Math.min(src.sw, src.sh);
  const fside = base * 0.46;
  const cx = src.sx + src.sw / 2;
  const cy = src.sy + src.sh / 2 + base * 0.15;
  const px0 = cx - fside / 2;
  const py0 = cy - fside / 2;
  fctx.drawImage(src.work, px0, py0, fside, fside, 0, 0, size, size);

  // Erase the printed number/figure stamped on the photographed face (we bake our own
  // number on top) while keeping small texture detail like stars, flecks and glitter.
  removeFaceMarkings(fctx, size);

  // Vibrancy boost: push saturation around the mean so colourful/translucent dies
  // don't read washed-out.
  const id = fctx.getImageData(0, 0, size, size);
  const d = id.data;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  const n = size * size;
  for (let i = 0; i < n; i += 1) {
    mr += d[i * 4]!;
    mg += d[i * 4 + 1]!;
    mb += d[i * 4 + 2]!;
  }
  mr /= n;
  mg /= n;
  mb /= n;
  const sat = 1.32;
  for (let i = 0; i < n; i += 1) {
    d[i * 4] = clamp255(mr + (d[i * 4]! - mr) * sat);
    d[i * 4 + 1] = clamp255(mg + (d[i * 4 + 1]! - mg) * sat);
    d[i * 4 + 2] = clamp255(mb + (d[i * 4 + 2]! - mb) * sat);
  }
  fctx.putImageData(id, 0, 0);
  return { canvas: face, body: src.body };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Paint out the large printed number/figure stamped on a die face while preserving fine
 * texture (stars, flecks, glitter). The number is the one *large* connected blob whose
 * brightness deviates strongly from the face's median; small specks are left alone. The
 * blob is then filled in by iteratively averaging surrounding clean pixels.
 */
function removeFaceMarkings(ctx: CanvasRenderingContext2D, size: number): void {
  let id: ImageData;
  try {
    id = ctx.getImageData(0, 0, size, size);
  } catch {
    return;
  }
  const d = id.data;
  const N = size * size;

  const lum = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    lum[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  }
  const sortedSample: number[] = [];
  for (let i = 0; i < N; i += 7) sortedSample.push(lum[i]!);
  sortedSample.sort((a, b) => a - b);
  const median = sortedSample[sortedSample.length >> 1] ?? 128;

  // Candidate marking pixels: strongly brighter/darker than the face median.
  const thr = 52;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) {
    if (Math.abs(lum[i]! - median) > thr) mask[i] = 1;
  }

  // Keep only large connected components (the number/figure); discard small specks.
  const visited = new Uint8Array(N);
  const fill = new Uint8Array(N);
  const stack = new Int32Array(N);
  const minBlob = Math.floor(N * 0.012);
  for (let s = 0; s < N; s += 1) {
    if (!mask[s] || visited[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    visited[s] = 1;
    const comp: number[] = [];
    while (sp > 0) {
      const p = stack[--sp]!;
      comp.push(p);
      const x = p % size;
      const y = (p / size) | 0;
      if (x > 0 && mask[p - 1] && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < size - 1 && mask[p + 1] && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - size] && !visited[p - size]) { visited[p - size] = 1; stack[sp++] = p - size; }
      if (y < size - 1 && mask[p + size] && !visited[p + size]) { visited[p + size] = 1; stack[sp++] = p + size; }
    }
    if (comp.length >= minBlob) {
      for (const p of comp) fill[p] = 1;
    }
  }

  // Dilate the fill region slightly so the number's anti-aliased halo is covered too.
  const grow = new Uint8Array(fill);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      if (fill[i]) continue;
      if (
        (x > 0 && fill[i - 1]) ||
        (x < size - 1 && fill[i + 1]) ||
        (y > 0 && fill[i - size]) ||
        (y < size - 1 && fill[i + size])
      ) {
        grow[i] = 1;
      }
    }
  }
  for (let i = 0; i < N; i += 1) fill[i] = grow[i]!;

  // Iteratively inpaint filled pixels by averaging valid (non-fill) neighbours.
  const valid = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) valid[i] = fill[i] ? 0 : 1;
  let remaining: number[] = [];
  for (let i = 0; i < N; i += 1) if (fill[i]) remaining.push(i);

  for (let pass = 0; pass < 200 && remaining.length > 0; pass += 1) {
    const next: number[] = [];
    for (const i of remaining) {
      const x = i % size;
      const y = (i / size) | 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      if (x > 0 && valid[i - 1]) { r += d[(i - 1) * 4]!; g += d[(i - 1) * 4 + 1]!; b += d[(i - 1) * 4 + 2]!; c += 1; }
      if (x < size - 1 && valid[i + 1]) { r += d[(i + 1) * 4]!; g += d[(i + 1) * 4 + 1]!; b += d[(i + 1) * 4 + 2]!; c += 1; }
      if (y > 0 && valid[i - size]) { r += d[(i - size) * 4]!; g += d[(i - size) * 4 + 1]!; b += d[(i - size) * 4 + 2]!; c += 1; }
      if (y < size - 1 && valid[i + size]) { r += d[(i + size) * 4]!; g += d[(i + size) * 4 + 1]!; b += d[(i + size) * 4 + 2]!; c += 1; }
      if (c > 0) {
        d[i * 4] = Math.round(r / c);
        d[i * 4 + 1] = Math.round(g / c);
        d[i * 4 + 2] = Math.round(b / c);
        valid[i] = 1;
      } else {
        next.push(i);
      }
    }
    if (next.length === remaining.length) break;
    remaining = next;
  }

  ctx.putImageData(id, 0, 0);
}

/** Deterministic PRNG so the glitter flecks line up between albedo + roughness maps. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GLITTER_SEED = 0x9e3779b1;

/**
 * Scatter glitter flecks. In `albedo` mode it paints bright sparkles onto the face
 * colour; in `rough` mode it paints the *same* spots dark (= smoother / shinier) so
 * each fleck catches the light and twinkles as the die rolls.
 */
function drawGlitter(ctx: CanvasRenderingContext2D, size: number, mode: 'albedo' | 'rough'): void {
  const rng = mulberry32(GLITTER_SEED);
  const count = Math.floor((size * size) / 900);
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.0009 + rng() * 0.0022);
    const a = 0.25 + rng() * 0.6;
    if (mode === 'albedo') {
      const warm = rng() < 0.3;
      ctx.fillStyle = warm
        ? `rgba(255,246,214,${a})`
        : `rgba(255,255,255,${a})`;
    } else {
      ctx.fillStyle = `rgba(0,0,0,${0.5 + rng() * 0.5})`;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Build a roughness map matching the albedo: a mid-grey base (semi-glossy) with the
 * glitter flecks punched dark so they read as tiny mirror-like sparkles.
 */
export function buildDieRoughnessCanvas(size = 1024): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.fillStyle = '#777777';
  ctx.fillRect(0, 0, size, size);
  drawGlitter(ctx, size, 'rough');
  return out;
}

/** One number to bake into an atlas cell (cell-normalised coords, v points up). */
export interface DieCellLabel {
  text: string;
  u: number;
  v: number;
  rot: number;
  size: number;
}

/**
 * Build a numbered atlas texture: a `cols × rows` grid where each cell shows the
 * scanned artwork (or a solid body colour) as the face material, with baked,
 * auto-contrast numbers placed and rotated per {@link buildNumberedDie}'s layout
 * (one centred number for d6–d20, three corner numbers for the traditional d4).
 */
export function buildNumberedDieTextureCanvas(opts: {
  img: HTMLImageElement | null;
  bodyColor: string;
  zoom: number;
  cols: number;
  rows: number;
  cellLabels: DieCellLabel[][];
  size?: number;
}): HTMLCanvasElement {
  const { img, bodyColor, zoom, cols, rows, cellLabels } = opts;
  const size = opts.size ?? 1536;
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  ctx.imageSmoothingQuality = 'high';

  const clean = img ? buildCleanFaceCanvas(img, zoom) : null;
  const body = clean?.body ?? bodyColor;

  const cellW = size / cols;
  const cellH = size / rows;

  // Contrast the number against the body so it is readable over any pattern.
  const dark = relativeLuminance(body) < 0.5;
  const numberFill = dark ? '#f5f0e6' : '#15110a';
  const numberStroke = dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // Pass 1: face material (cleaned scanned artwork or solid body colour).
  cellLabels.forEach((labels, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dx = col * cellW;
    const dy = row * cellH;
    ctx.fillStyle = body;
    ctx.fillRect(dx, dy, cellW + 1, cellH + 1);
    if (clean) ctx.drawImage(clean.canvas, 0, 0, clean.canvas.width, clean.canvas.height, dx, dy, cellW, cellH);
  });

  // Pass 2: glitter sparkle across the whole atlas (under the numbers).
  drawGlitter(ctx, size, 'albedo');

  // Pass 3: baked numbers on top, so they stay crisp and readable.
  cellLabels.forEach((labels, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dx = col * cellW;
    const dy = row * cellH;

    for (const label of labels) {
      const fontPx = Math.min(cellW, cellH) * label.size;
      // Cell coords have v pointing up; canvas y points down.
      const px = dx + label.u * cellW;
      const py = dy + (1 - label.v) * cellH;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(label.rot);
      ctx.font = `700 ${fontPx}px "Cinzel", Georgia, serif`;
      ctx.lineWidth = fontPx * 0.16;
      ctx.strokeStyle = numberStroke;
      ctx.strokeText(label.text, 0, 0);
      ctx.fillStyle = numberFill;
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
    }
  });

  return out;
}
