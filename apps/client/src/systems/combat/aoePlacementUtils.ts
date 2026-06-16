import { getMapInteractionEl } from '@/systems/scene/sceneRefs';
import { syncSpellEffectsToServer } from '@/systems/spells/effectSync';
import { useSpellEffectStore } from '@/systems/spells/effectStore';
import { purgeMapAreaOverlayGraphics } from './mapAreaOverlay';
import { useCombatStore } from './combatStore';

export function isAoePlacementActive(): boolean {
  return useCombatStore.getState().aoePlacement != null;
}

export function normalizeSpellActionName(name: string): string {
  return name.trim().toLowerCase();
}

export function aoeActionNamesMatch(a: string, b: string): boolean {
  return normalizeSpellActionName(a) === normalizeSpellActionName(b);
}

export function isPointerOverMapInteraction(clientX: number, clientY: number): boolean {
  const el = getMapInteractionEl();
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** Remove combat AoE preview + confirmed template from the map. */
export function clearMapAoeShapes(): void {
  useCombatStore.getState().clearMapAoeShapes();
  purgeMapAreaOverlayGraphics();
}

/** Remove all area overlays: combat templates + synced cast spell zones. */
export function clearAllMapAreaShapes(): void {
  useCombatStore.getState().clearMapAoeShapes();

  const zoneEffects = useSpellEffectStore.getState().effects.filter(
    (e) => !e.ended && e.placement && e.aoe,
  );
  for (const effect of zoneEffects) {
    useSpellEffectStore.getState().removeEffect(effect.id, 'manual');
  }

  syncSpellEffectsToServer();
  purgeMapAreaOverlayGraphics();
}

export function mapAreaShapeCount(): number {
  const combat = useCombatStore.getState();
  let n = 0;
  if (combat.aoeDisplay) n += 1;
  if (combat.aoePlacement) n += 1;
  n += useSpellEffectStore.getState().effects.filter(
    (e) => !e.ended && e.placement && e.aoe,
  ).length;
  return n;
}

export function hasMapAreaShapes(): boolean {
  return mapAreaShapeCount() > 0;
}
