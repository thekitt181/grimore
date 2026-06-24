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

/** Read a file as a resized, compressed data URL suitable for compendium images. */
export function fileToCompressedDataUrl(file: File, maxDim = 1024, quality = 0.9): Promise<string> {
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
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
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
