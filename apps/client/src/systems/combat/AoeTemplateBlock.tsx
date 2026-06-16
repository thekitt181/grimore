import type { TokenItem } from '@/systems/scene/types';
import type { ActionDamage } from '@/systems/compendium/statBlockParser';
import { formatActionDamage } from '@/systems/compendium/statBlockParser';
import { AoeGatedRollButton } from './AoeGatedRollButton';
import { AoePlaceButton } from './AoePlaceButton';
import { CastSpellEffectButton } from '@/systems/spells/CastSpellEffectButton';

/** Area template + gated damage rolls (no save-for-half apply flow). */
export function AoeTemplateBlock({
  effectName,
  token,
  aoe,
  damages,
  saveStat,
  rollVariant = 'spell',
  concentration,
  description,
}: {
  effectName: string;
  token: TokenItem;
  aoe: { size: number; type: string };
  damages: ActionDamage[];
  saveStat?: string;
  rollVariant?: 'spell' | 'damage';
  concentration?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <AoePlaceButton
        sourceTokenId={token.id}
        sourceTokenName={token.name}
        actionName={effectName}
        aoe={aoe}
      />
      <CastSpellEffectButton
        spellName={effectName}
        token={token}
        aoe={aoe}
        {...(concentration ? { concentration: true } : {})}
        {...(description ? { description } : {})}
      />
      {saveStat && (
        <p className="font-ui text-[9px] text-center" style={{ color: '#fca5a5' }}>
          {saveStat} save
        </p>
      )}
      {damages.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {damages.map((dmg, i) => (
            <AoeGatedRollButton
              key={`${dmg.dice}-${i}`}
              effectName={effectName}
              tokenId={token.id}
              aoe={aoe}
              notation={dmg.dice.replace(/\s+/g, '')}
              label={formatActionDamage(dmg)}
              variant={rollVariant}
            />
          ))}
        </div>
      )}
      {damages.length === 0 && (
        <p className="font-ui text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
          Place area on map — apply effect manually
        </p>
      )}
    </div>
  );
}
