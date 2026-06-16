import type { CompendiumSpell } from '@grimoire/shared';
import { CasterTokenHint } from '@/systems/combat/CasterTokenHint';
import { useCasterToken } from '@/systems/combat/useCasterToken';
import {
  SPELL_EFFECTS_BY_ID,
  type SpellEffectCatalogEntry,
} from '@/systems/spells/spellEffectsCatalog';
import { castModeLabel, defaultDescription } from '@/systems/spells/spellCastPlacement';
import { SpellEffectCastControls } from '@/systems/spells/SpellEffectCastControls';
import { defaultCastLevel, resolveProjectileCount } from '@/systems/spells/spellLevelScaling';
import { SpellRollPanel } from './SpellRollPanel';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function EffectCastBlock({ entry, spell }: { entry: SpellEffectCatalogEntry; spell?: CompendiumSpell }) {
  const caster = useCasterToken();

  if (!caster) return <CasterTokenHint />;

  const aoe = entry.aoe ?? spell?.aoe;

  return (
    <SpellEffectCastControls
      casterToken={caster}
      spellName={entry.name}
      catalog={entry}
      {...(spell?.level != null ? { compendiumLevel: spell.level } : {})}
      concentration={entry.concentration}
      description={spell?.description ?? defaultDescription(entry)}
      {...(aoe ? { aoe } : {})}
    />
  );
}

export function SpellEffectReferencePanel({
  catalogId,
  spell,
  compendiumLoading = false,
  compendiumError = false,
}: {
  catalogId: string;
  spell?: CompendiumSpell;
  compendiumLoading?: boolean;
  compendiumError?: boolean;
}) {
  const entry = SPELL_EFFECTS_BY_ID[catalogId];
  if (!entry) {
    return (
      <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
        Unknown spell effect.
      </p>
    );
  }

  const displayLevel = defaultCastLevel(entry, spell?.level);
  const scaledProjectiles = resolveProjectileCount(entry.id, displayLevel);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-display text-sm" style={{ color: GOLD }}>
          {entry.name}
        </h3>
        <p className="font-ui text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          JB2A animation · {castModeLabel(entry.castMode)}
          {entry.aoe ? ` · ${entry.aoe.size} ft ${entry.aoe.type}` : ''}
          {entry.concentration ? ' · Concentration' : ''}
          {scaledProjectiles != null
            ? ` · ${scaledProjectiles} projectile${scaledProjectiles > 1 ? 's' : ''}`
            : entry.maxTargets > 0
              ? ` · ${entry.maxTargets} target${entry.maxTargets > 1 ? 's' : ''}`
              : ''}
        </p>
      </div>

      <div className="rounded px-2 py-2 space-y-2" style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}>
        <p className="font-ui text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
          Map effect
        </p>
        <EffectCastBlock entry={entry} {...(spell ? { spell } : {})} />
      </div>

      {compendiumLoading && (
        <p className="font-ui text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Loading compendium match…
        </p>
      )}

      {!compendiumLoading && spell && (
        <>
          <div className="gold-divider" />
          <SpellRollPanel spell={spell} />
        </>
      )}

      {!compendiumLoading && !spell && !compendiumError && (
        <p className="font-ui text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          No matching compendium entry — map VFX still works. Import this spell via D&amp;B Beyond for full stat block and rolls.
        </p>
      )}
    </div>
  );
}
