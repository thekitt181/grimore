import { FEET_PER_CELL } from '@/systems/combat/aoeGeometry';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { Item, TokenItem } from '../types';

let labelEl: HTMLDivElement | null = null;

function ensureLabel(): HTMLDivElement {
  if (!labelEl) {
    labelEl = document.createElement('div');
    labelEl.setAttribute('aria-live', 'polite');
    Object.assign(labelEl.style, {
      position: 'fixed',
      zIndex: '10000',
      pointerEvents: 'none',
      padding: '4px 10px',
      borderRadius: '4px',
      background: 'rgba(10, 10, 15, 0.92)',
      border: '1px solid #c9a84c',
      color: '#e8e0d0',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'Inter, system-ui, sans-serif',
      transform: 'translate(-50%, calc(-100% - 10px))',
      display: 'none',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(labelEl);
  }
  return labelEl;
}

export function showResizeSizeLabel(clientX: number, clientY: number, text: string): void {
  const el = ensureLabel();
  el.textContent = text;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.style.display = 'block';
}

export function hideResizeSizeLabel(): void {
  if (labelEl) labelEl.style.display = 'none';
}

/** Live feet readout while resizing (tokens use sizeCells; others use map grid). */
export function formatResizeFeetLabel(
  item: Item,
  width: number,
  height: number,
  baseWidth?: number,
): string | null {
  if (item.type === 'token') {
    const token = item as TokenItem;
    const w0 = baseWidth ?? token.width;
    const cellPx = w0 / token.sizeCells;
    const sizeCells = Math.max(0.25, width / cellPx);
    const feet = Math.round(sizeCells * FEET_PER_CELL);
    return `${feet} ft`;
  }

  const gridSize = useMapStore.getState().gridSize;
  const wFt = Math.round((width / gridSize) * FEET_PER_CELL);
  const hFt = Math.round((height / gridSize) * FEET_PER_CELL);
  if (item.type === 'map' || item.type === 'handout' || item.type === 'image' || wFt === hFt) {
    return `${wFt} ft`;
  }
  return `${wFt} × ${hFt} ft`;
}
