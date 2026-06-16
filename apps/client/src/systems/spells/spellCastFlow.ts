import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { commitSpellEffect } from './castSpellEffect';
import {
  findSpellEffectCatalogEntry,
  type SpellEffectCatalogEntry,
} from './spellEffectsCatalog';
import {
  POINT_BURST_AOE,
  defaultDescription,
  placementFromCasterToTarget,
  placementOnToken,
} from './spellCastPlacement';
import { pickSpellTargets } from './pickSpellTargets';
import {
  defaultCastLevel,
  resolveProjectileCount,
  resolveScaledMaxTargets,
  spellAllowsRepeatTargets,
} from './spellLevelScaling';

export function resolveMaxTargets(
  entry?: SpellEffectCatalogEntry,
  castLevel?: number,
): number {
  return resolveScaledMaxTargets(entry, castLevel);
}

export function needsTokenTargeting(
  entry?: SpellEffectCatalogEntry,
  castLevel?: number,
): boolean {
  return resolveMaxTargets(entry, castLevel) > 0;
}

function tokenById(id: string): TokenItem | undefined {
  const item = useItemStore.getState().items[id];
  return item?.type === 'token' ? item : undefined;
}

export interface CastSpellWithTargetingInput {
  casterToken: TokenItem;
  spellName: string;
  catalog?: SpellEffectCatalogEntry;
  castLevel?: number;
  concentration?: boolean;
  description?: string;
  durationText?: string;
  aoe?: { size: number; type: string };
  placement?: ReturnType<typeof placementOnToken>;
}

export async function castSpellEffectWithTargeting(input: CastSpellWithTargetingInput): Promise<void> {
  const catalog = input.catalog ?? findSpellEffectCatalogEntry(input.spellName);
  const spellName = catalog?.name ?? input.spellName;
  const castLevel = input.castLevel ?? defaultCastLevel(catalog);
  const maxTargets = resolveMaxTargets(catalog, castLevel);
  const projectileCount = catalog ? resolveProjectileCount(catalog.id, castLevel) : null;

  let targetTokenIds: string[] = [];
  if (maxTargets > 0) {
    targetTokenIds = await pickSpellTargets({
      casterTokenId: input.casterToken.id,
      casterName: input.casterToken.name,
      spellName,
      maxTargets,
      castLevel,
      ...(projectileCount != null ? { projectileCount } : {}),
      ...(catalog && spellAllowsRepeatTargets(catalog.id) ? { allowRepeatTargets: true } : {}),
    });
    if (targetTokenIds.length === 0) return;
  }

  let aoe = input.aoe;
  let placement = input.placement;

  const primaryTarget = targetTokenIds[0] ? tokenById(targetTokenIds[0]) : undefined;

  if (catalog?.castMode === 'aoe' && aoe && placement) {
    // keep AoE placement from map
  } else if (catalog?.castMode === 'aoe' && aoe) {
    placement = placement ?? placementOnToken(input.casterToken);
  } else if (catalog?.castMode === 'melee' && primaryTarget) {
    aoe = POINT_BURST_AOE;
    placement = placementOnToken(primaryTarget);
  } else if (catalog?.castMode === 'ranged' && primaryTarget) {
    aoe = POINT_BURST_AOE;
    placement = placementFromCasterToTarget(input.casterToken, primaryTarget);
  } else if (catalog?.castMode === 'self' || !catalog) {
    aoe = aoe ?? POINT_BURST_AOE;
    placement = placement ?? placementOnToken(input.casterToken);
  } else {
    aoe = aoe ?? catalog?.aoe ?? POINT_BURST_AOE;
    placement = placement ?? placementOnToken(primaryTarget ?? input.casterToken);
  }

  if (!aoe || !placement) return;

  const casterUserId = useSessionStore.getState().myUserId ?? undefined;

  commitSpellEffect({
    spellName,
    casterToken: input.casterToken,
    castSlotLevel: castLevel,
    ...(projectileCount != null ? { projectileCount } : {}),
    ...(casterUserId ? { casterUserId } : {}),
    ...(input.durationText ? { durationText: input.durationText } : {}),
    ...(input.concentration ?? catalog?.concentration
      ? { concentration: input.concentration ?? catalog!.concentration }
      : {}),
    ...(input.description ?? (catalog ? defaultDescription(catalog) : undefined)
      ? { description: input.description ?? defaultDescription(catalog!) }
      : {}),
    ...(aoe ? { aoe } : {}),
    ...(placement ? { placement } : {}),
    ...(targetTokenIds.length > 0 ? { targetTokenIds } : {}),
  });
}
