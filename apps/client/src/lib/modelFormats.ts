export type ModelFormat = 'glb' | 'gltf' | 'stl';

export const MODEL_FILE_ACCEPT =
  '.glb,.gltf,.stl,model/gltf-binary,model/gltf+json,model/stl,application/sla,application/octet-stream';

export const MAP_ASSET_ACCEPT = `image/*,${MODEL_FILE_ACCEPT}`;

const MODEL_EXT_RE = /\.(glb|gltf|stl)$/i;

export function modelFormatFromName(name: string): ModelFormat | null {
  const match = name.match(MODEL_EXT_RE);
  if (!match) return null;
  return match[1]!.toLowerCase() as ModelFormat;
}

export function modelFormatFromUrl(url: string): ModelFormat | null {
  const fromName = modelFormatFromName(url.split('?')[0]?.split('#')[0]?.split('/').pop() ?? '');
  if (fromName) return fromName;

  const path = url.split('?')[0]?.split('#')[0] ?? url;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'glb') return 'glb';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'stl') return 'stl';
  if (url.startsWith('data:model/gltf-binary')) return 'glb';
  if (url.startsWith('data:model/gltf+json')) return 'gltf';
  if (url.startsWith('data:model/stl') || url.startsWith('data:application/sla')) return 'stl';
  return null;
}

export function isModelUrl(url: string | null | undefined, formatHint?: ModelFormat | null): url is string {
  if (!url) return false;
  if (formatHint) return true;
  return modelFormatFromUrl(url) != null;
}

export function isModelFile(file: File): boolean {
  if (modelFormatFromName(file.name)) return true;
  const t = file.type.toLowerCase();
  return t.includes('gltf') || t.includes('stl') || t === 'application/sla';
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isMapAssetFile(file: File): boolean {
  return isImageFile(file) || isModelFile(file);
}

/** Rewrite generic data-URL mime so GLB/STL loaders recognize dropped files. */
export function normalizeModelDataUrl(dataUrl: string, format: ModelFormat): string {
  if (!dataUrl.startsWith('data:')) return dataUrl;
  const mime =
    format === 'glb' ? 'model/gltf-binary'
    : format === 'gltf' ? 'model/gltf+json'
    : 'model/stl';
  return dataUrl.replace(/^data:[^;,]*/, `data:${mime}`);
}

export interface AssetDataUrl {
  url: string;
  isModel: boolean;
  format: ModelFormat | null;
}

/** Read a dropped/uploaded file; normalizes 3D model mime types for loaders + persistence. */
export async function fileToAssetDataUrl(file: File): Promise<AssetDataUrl> {
  const { fileToDataUrl } = await import('@/lib/imagePersistence');
  const url = await fileToDataUrl(file);
  const format = modelFormatFromName(file.name)
    ?? (file.type.toLowerCase().includes('gltf') ? (file.name.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb') : null)
    ?? (file.type.toLowerCase().includes('stl') ? 'stl' : null);
  if (!format) {
    return { url, isModel: false, format: null };
  }
  return { url: normalizeModelDataUrl(url, format), isModel: true, format };
}
