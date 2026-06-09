/** Blob URLs are session-only and break after refresh — never persist them. */
export function isPersistableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return !url.startsWith('blob:');
}

/** Read a dropped/uploaded file as a data URL that survives page refresh. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/** Load image dimensions from any URL (http, data, blob). */
export function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ w: img.naturalWidth || 1920, h: img.naturalHeight || 1080 });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
