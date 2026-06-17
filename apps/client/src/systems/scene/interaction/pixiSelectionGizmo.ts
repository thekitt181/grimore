import { Graphics } from 'pixi.js';
import type { TokenGizmoLayout } from '@/systems/scene/token/tokenGizmoLayout';

const GOLD = 0xc9a84c;

/** Draw selection box + handles on the Pixi overlay (2D view — same coords as map/tokens). */
export function drawPixiSelectionGizmo(
  box: Graphics,
  handlesG: Graphics,
  layout: TokenGizmoLayout,
): void {
  box.clear();
  handlesG.clear();

  if (layout.mode === 'none' || layout.boxCorners.length < 4) {
    box.visible = false;
    handlesG.visible = false;
    return;
  }

  box.visible = true;
  handlesG.visible = true;

  const corners = layout.boxCorners;
  box.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < corners.length; i++) {
    box.lineTo(corners[i]!.x, corners[i]!.y);
  }
  box.closePath();
  box.setStrokeStyle({ width: 2, color: GOLD, alpha: 0.95 });
  box.stroke();

  for (const h of layout.handles) {
    if (h.id === 'rotate') {
      handlesG.circle(h.wx, h.wy, 12);
      handlesG.fill({ color: GOLD, alpha: 1 });
      handlesG.setStrokeStyle({ width: 1.5, color: 0xffffff, alpha: 0.9 });
      handlesG.stroke();
    } else {
      handlesG.rect(h.wx - 8, h.wy - 8, 16, 16);
      handlesG.fill({ color: GOLD, alpha: 1 });
    }
  }
}

export function hidePixiSelectionGizmo(box: Graphics, handlesG: Graphics): void {
  box.clear();
  handlesG.clear();
  box.visible = false;
  handlesG.visible = false;
}
