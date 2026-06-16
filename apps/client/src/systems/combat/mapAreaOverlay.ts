import { sceneRefs } from '@/systems/scene/sceneRefs';
import { clearAllSpellVideoVfx } from '@/systems/spells/spellVfxPlayer';

const AREA_OVERLAY_LABELS = [
  'aoe-preview',
  'aoe-display',
  'spell-vfx',
  'spell-vfx-cast',
  'spell-vfx-zone',
  'spell-target-highlight',
] as const;

/** Remove all combat/cast area graphics from the Pixi overlay (fixes ghost circles). */
export function purgeMapAreaOverlayGraphics(): void {
  clearAllSpellVideoVfx();
  const layer = sceneRefs.overlay.current;
  if (!layer) return;

  for (const label of AREA_OVERLAY_LABELS) {
    for (;;) {
      const child = layer.getChildByLabel(label);
      if (!child) break;
      layer.removeChild(child);
      child.destroy({ children: true });
    }
  }
}
