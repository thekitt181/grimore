/** True only when the OS is dragging files onto the page (not pointer/marquee drags). */
export function isExternalFileDrag(dt: DataTransfer | null): boolean {
  if (!dt?.types?.length) return false;
  return Array.from(dt.types).includes('Files');
}

/** Accept http(s) URL drags on drop (no overlay during drag). */
export function isExternalUrlDrag(dt: DataTransfer | null): boolean {
  if (!dt?.types?.length) return false;
  return Array.from(dt.types).includes('text/uri-list');
}
