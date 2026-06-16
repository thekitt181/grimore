import { useEffect, useRef, useState } from 'react';
import type { TokenItem } from '@/systems/scene/types';
import { useCombatStore } from '@/systems/combat/combatStore';
import { aoeActionNamesMatch } from '@/systems/combat/aoePlacementUtils';
import { AoePlaceButton } from '@/systems/combat/AoePlaceButton';
import type { SpellEffectCatalogEntry } from './spellEffectsCatalog';
import { findSpellEffectCatalogEntry } from './spellEffectsCatalog';
import { castModeLabel } from './spellCastPlacement';
import { castSpellEffectWithTargeting, needsTokenTargeting, resolveMaxTargets } from './spellCastFlow';
import { isSpellTargetPicking, cancelSpellTargetPick } from './pickSpellTargets';
import { EndSpellEffectButton } from './EndSpellEffectButton';
import { extractDurationFromDescription } from '@grimoire/shared';
import { defaultDescription } from './spellCastPlacement';
import { SpellCastLevelSelect } from './SpellCastLevelSelect';
import { defaultCastLevel, resolveProjectileCount, scalingSummary, spellAllowsRepeatTargets } from './spellLevelScaling';

const GOLD = 'var(--color-accent-gold)';

export function SpellEffectCastControls({
  casterToken,
  spellName,
  catalog: catalogProp,
  compendiumLevel,
  concentration,
  description,
  aoe: aoeProp,
  compact = false,
}: {
  casterToken: TokenItem;
  spellName: string;
  catalog?: SpellEffectCatalogEntry;
  compendiumLevel?: number;
  concentration?: boolean;
  description?: string;
  aoe?: { size: number; type: string };
  compact?: boolean;
}) {
  const [casting, setCasting] = useState(false);
  const castingRef = useRef(false);
  const aoeDisplay = useCombatStore((s) => s.aoeDisplay);
  const catalog = catalogProp ?? findSpellEffectCatalogEntry(spellName);
  const [castLevel, setCastLevel] = useState(() => defaultCastLevel(catalog, compendiumLevel));
  const effectiveAoe = aoeProp ?? catalog?.aoe;
  const placed =
    catalog?.castMode === 'aoe'
    && effectiveAoe
    && aoeDisplay?.sourceTokenId === casterToken.id
    && aoeActionNamesMatch(aoeDisplay.actionName, catalog?.name ?? spellName);

  const needsPlacement = catalog?.castMode === 'aoe' && Boolean(effectiveAoe) && !placed;
  const maxTargets = resolveMaxTargets(catalog, castLevel);
  const projectileCount = catalog ? resolveProjectileCount(catalog.id, castLevel) : null;
  const targeting = needsTokenTargeting(catalog, castLevel);

  useEffect(() => {
    setCastLevel(defaultCastLevel(catalog, compendiumLevel));
  }, [catalog?.id, compendiumLevel]);

  useEffect(() => {
    castingRef.current = casting;
  }, [casting]);

  useEffect(() => () => {
    if (castingRef.current) cancelSpellTargetPick();
  }, []);

  async function handleCast() {
    if (needsPlacement || casting || isSpellTargetPicking()) return;
    setCasting(true);
    try {
      await castSpellEffectWithTargeting({
        casterToken,
        spellName: catalog?.name ?? spellName,
        castLevel,
        ...(catalog ? { catalog } : {}),
        ...((concentration ?? catalog?.concentration) !== undefined
          ? { concentration: concentration ?? catalog!.concentration }
          : {}),
        ...(description ?? (catalog ? defaultDescription(catalog) : undefined)
          ? { description: description ?? defaultDescription(catalog!) }
          : {}),
        ...(extractDurationFromDescription(description)
          ? { durationText: extractDurationFromDescription(description)! }
          : {}),
        ...(effectiveAoe ? { aoe: effectiveAoe } : {}),
        ...(placed ? { placement: aoeDisplay!.placement } : {}),
      });
    } finally {
      setCasting(false);
    }
  }

  const btnClass = compact
    ? 'font-ui text-[10px] px-2 py-1 rounded transition-all hover:opacity-90 w-full disabled:opacity-40'
    : 'font-ui text-xs px-2 py-1 rounded transition-all hover:opacity-90 w-full disabled:opacity-40';

  return (
    <div className="space-y-1.5">
      <SpellCastLevelSelect
        {...(catalog ? { catalog } : {})}
        {...(compendiumLevel != null ? { compendiumLevel } : {})}
        castLevel={castLevel}
        onCastLevelChange={setCastLevel}
      />

      {catalog?.castMode === 'aoe' && effectiveAoe && (
        <AoePlaceButton
          sourceTokenId={casterToken.id}
          sourceTokenName={casterToken.name}
          actionName={catalog.name}
          aoe={effectiveAoe}
        />
      )}

      {targeting && (
        <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
          {maxTargets === 1
            ? `Cast will ask you to click 1 target on the map`
            : projectileCount != null
              ? catalog && spellAllowsRepeatTargets(catalog.id)
                ? `Assign each missile — ${scalingSummary(catalog, castLevel) ?? `${projectileCount} projectiles`}`
                : `Pick up to ${maxTargets} targets · ${scalingSummary(catalog!, castLevel) ?? `${projectileCount} projectiles`}`
              : `Cast will ask you to click up to ${maxTargets} targets`}
        </p>
      )}

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void handleCast()}
          disabled={needsPlacement || casting || isSpellTargetPicking()}
          className={`${btnClass} flex-1`}
          style={{
            background: 'rgba(201,168,76,0.15)',
            border: `1px solid ${GOLD}`,
            color: GOLD,
          }}
        >
          {casting ? 'Casting…' : `Cast effect${needsPlacement ? ' (place AoE first)' : targeting ? ' (pick targets)' : ''}`}
        </button>
        <EndSpellEffectButton
          spellName={catalog?.name ?? spellName}
          casterTokenId={casterToken.id}
          className="shrink-0"
        />
      </div>

      {catalog && compact && (
        <span className="font-ui text-[8px] uppercase" style={{ color: 'var(--color-text-secondary)' }}>
          {castModeLabel(catalog.castMode)}
        </span>
      )}
    </div>
  );
}
