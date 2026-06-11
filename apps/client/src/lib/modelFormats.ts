export type ModelFormat = 'glb' | 'gltf' | 'stl';

export const MODEL_FILE_ACCEPT =
  '.glb,.gltf,.stl,model/gltf-binary,model/gltf+json,model/stl,application/sla,application/octet-stream';

export const MAP_ASSET_ACCEPT = `image/*,${MODEL_FILE_ACCEPT}`;

export function modelFormatFromUrl(url: string): ModelFormat | null {
  const path = url.split('?')[0]?.split('#')[0] ?? url;
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'glb') return 'glb';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'stl') return 'stl';
  if (url.startsWith('data:model/gltf-binary') || url.startsWith('data:application/octet-stream')) return 'glb';
  if (url.startsWith('data:model/gltf+json')) return 'gltf';
  if (url.startsWith('data:model/stl') || url.startsWith('data:application/sla')) return 'stl';
  return null;
}

export function isModelUrl(url: string | null | undefined): url is string {
  return !!url && modelFormatFromUrl(url) != null;
}

export function isModelFile(file: File): boolean {
  if (modelFormatFromUrl(file.name)) return true;
  const t = file.type.toLowerCase();
  return t.includes('gltf') || t.includes('stl') || t === 'application/sla' || t === 'application/octet-stream';
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isMapAssetFile(file: File): boolean {
  return isImageFile(file) || isModelFile(file);
}
