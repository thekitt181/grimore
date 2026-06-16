import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { useSpellEffectTargetStore } from './spellEffectTargetStore';
import { spellVfxUsesScreenLayer } from './spellVfxScreenUtils';

const GOLD = 0xc9a84c;
const GOLD_DIM = 0xc9a84c;

function drawTokenRing(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  opts: { fill?: boolean; width?: number; alpha?: number; dashed?: boolean },
) {
  g.circle(cx, cy, r);
  if (opts.fill) {
    g.fill({ color: GOLD, alpha: 0.12 });
  }
  g.stroke({
    color: GOLD_DIM,
    width: opts.width ?? 3,
    alpha: opts.alpha ?? 0.95,
    ...(opts.dashed ? { alignment: 0.5 } : {}),
  });
}

export function useSpellTargetHighlights(appReady: boolean) {
  const pick = useSpellEffectTargetStore((s) => s.pick);
  const items = useItemStore((s) => s.items);
  const liveById = useLiveTransformStore((s) => s.byId);
  const gRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady) return;
    const overlay = sceneRefs.overlay.current;
    if (!overlay) return;

    let g = overlay.getChildByLabel('spell-target-highlight') as Graphics | null;
    if (!g || g.destroyed) {
      g = new Graphics();
      g.label = 'spell-target-highlight';
      g.eventMode = 'none';
      overlay.addChild(g);
    }
    gRef.current = g;

    return () => {
      gRef.current = null;
    };
  }, [appReady]);

  useEffect(() => {
    const g = gRef.current;
    const overlay = sceneRefs.overlay.current;
    if (!g || g.destroyed || !overlay) return;

    g.clear();
    if (!pick || spellVfxUsesScreenLayer()) return;

    // Keep highlight rings above AoE / spell VFX overlays.
    overlay.addChild(g);

    const drawIds = new Set(pick.selectedTargetIds);
    if (pick.hoverTokenId && !drawIds.has(pick.hoverTokenId)) {
      const hover = items[pick.hoverTokenId];
      if (hover?.type === 'token') {
        const b = resolveItemBounds(hover, liveById[hover.id]);
        const r = Math.max(28, Math.max(b.width, b.height) / 2 + 10);
        drawTokenRing(g, b.cx, b.cz, r, { width: 2, alpha: 0.55 });
      }
    }

    for (const id of [...new Set(pick.selectedTargetIds)]) {
      const token = items[id];
      if (token?.type !== 'token') continue;
      const b = resolveItemBounds(token, liveById[token.id]);
      const r = Math.max(28, Math.max(b.width, b.height) / 2 + 10);
      drawTokenRing(g, b.cx, b.cz, r, { fill: true, width: 4, alpha: 0.95 });
    }
  }, [pick, items, liveById]);
}
