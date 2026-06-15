/** True while the selection tool is dragging items (blocks 3D map pan). */
let itemDragActive = false;

export function setItemDragActive(active: boolean): void {
  itemDragActive = active;
}

export function isItemDragActive(): boolean {
  return itemDragActive;
}
