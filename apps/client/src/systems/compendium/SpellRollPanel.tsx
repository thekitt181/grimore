import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompendiumSpell } from '@grimoire/shared';
import { RollableText } from '@/systems/dice/RollableText';
import { CasterTokenHint } from '@/systems/combat/CasterTokenHint';
import { TokenActionCard } from '@/systems/combat/TokenActionCard';
import { useCasterToken } from '@/systems/combat/useCasterToken';
import { useCombatStore } from '@/systems/combat/combatStore';
import { compendiumSpellToParsedAction } from './statBlockParser';
import { syncDdbCharacter } from '@/systems/ddb/ddbApi';

export function SpellRollPanel({ spell }: { spell: CompendiumSpell }) {
  const caster = useCasterToken();
  const targetPick = useCombatStore((s) => s.targetPick);
  const [manualAttackMod, setManualAttackMod] = useState<number | null>(null);

  const { data: casterCharacter } = useQuery({
    queryKey: ['ddb', 'character', caster?.ddbCharacterId],
    queryFn: () => syncDdbCharacter(caster!.ddbCharacterId!),
    enabled: Boolean(caster?.ddbCharacterId),
    staleTime: 60_000,
  });

  const spellAttackMod = casterCharacter?.spellAttackMod;
  const spellSaveDc = casterCharacter?.spellSaveDc;
  const attackMod = manualAttackMod ?? spellAttackMod ?? 0;

  const action = useMemo(
    () => compendiumSpellToParsedAction(spell, {
      ...(spell.attack ? { toHit: attackMod } : {}),
      ...(spell.save && spellSaveDc != null ? { saveDc: spellSaveDc } : {}),
    }),
    [spell, attackMod, spellSaveDc],
  );

  const isActivePick = Boolean(
    caster && targetPick?.attackerTokenId === caster.id && targetPick.actionName === spell.name,
  );

  return (
    <div className="space-y-2">
      <p className="font-ui text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        Cast spell
      </p>

      {caster ? (
        <>
          {spell.attack && casterCharacter?.spellAttackMod == null && manualAttackMod == null && (
            <label className="font-ui text-[10px] flex gap-2 items-center" style={{ color: 'var(--color-text-secondary)' }}>
              Spell attack
              <input
                type="number"
                className="input-stat w-12"
                value={attackMod}
                onChange={(e) => setManualAttackMod(Number(e.target.value))}
              />
            </label>
          )}
          <TokenActionCard
            action={action}
            token={caster}
            isActivePick={isActivePick}
          />
        </>
      ) : (
        <CasterTokenHint />
      )}

      {spell.description && (
        <RollableText text={spell.description} className="max-h-48 overflow-y-auto" />
      )}
    </div>
  );
}
