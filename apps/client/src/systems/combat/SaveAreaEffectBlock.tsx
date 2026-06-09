import type { TokenItem } from '@/systems/scene/types';
import type { ActionDamage } from '@/systems/compendium/statBlockParser';
import { AoePlaceButton } from './AoePlaceButton';
import { SaveAreaDamageButton } from './SaveAreaDamageButton';

export function SaveAreaEffectBlock({
  effectName,
  token,
  damages,
  aoe,
  save,
}: {
  effectName: string;
  token: TokenItem;
  damages: ActionDamage[];
  aoe: { size: number; type: string };
  save?: { dc?: number; stat: string };
}) {
  return (
    <div className="space-y-1">
      <AoePlaceButton
        sourceTokenId={token.id}
        sourceTokenName={token.name}
        actionName={effectName}
        aoe={aoe}
      />
      {save && (
        <p className="font-ui text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
          {save.dc !== undefined ? `DC ${save.dc} ${save.stat}` : save.stat} · failed = full · success = half
        </p>
      )}
      {damages.map((dmg, i) => (
        <SaveAreaDamageButton
          key={`${dmg.dice}-${i}`}
          effectName={effectName}
          token={token}
          damage={dmg}
          aoe={aoe}
          {...(save ? { save } : {})}
        />
      ))}
    </div>
  );
}
