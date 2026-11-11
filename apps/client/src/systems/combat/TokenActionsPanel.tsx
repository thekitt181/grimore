import { useMemo } from 'react';
import { ActionTabList } from '@/systems/combat/ActionTabList';
import { useQuery } from '@tanstack/react-query';
import type { TokenItem } from '@/systems/scene/types';
import { DraggablePanel } from '@/components/DraggablePanel';
import { getMonster, searchSpells } from '@/systems/compendium/compendiumApi';
import {
  buildSpellLookup,
  getMonsterAbilities,
  inferMonsterAttackToHit,
  parseMonsterActions,
  parseSavingThrows,
  proficiencyBonusFromCr,
  type ParsedAction,
} from '@/systems/compendium/statBlockParser';
import { RollButton } from '@/systems/dice/RollButton';
import { RollModeBar } from '@/systems/dice/RollModeBar';
import { useCombatStore } from '@/systems/combat/combatStore';

const BD = 'var(--color-border)';
import { PanelAttackResult, PanelTargetPicker } from '@/systems/combat/TokenPanelCombatFlow';
import { SpellcastingCard } from './SpellcastingCard';
import { TokenActionCard } from './TokenActionCard';
import { parseNpcAttacks } from '@/systems/npcs/npcAttack';

export function TokenActionsPanel({ token, onClose }: { token: TokenItem; onClose: () => void }) {
  const targetPick = useCombatStore((s) => s.targetPick);

  const monsterFetchOpts = token.monsterSource?.trim()
    ? { source: token.monsterSource.trim() }
    : undefined;

  const { data: monster, isLoading, isError } = useQuery({
    queryKey: ['compendium', 'monster', token.monsterId, monsterFetchOpts?.source ?? ''],
    queryFn: () => getMonster(token.monsterId!, monsterFetchOpts),
    enabled: Boolean(token.monsterId),
    staleTime: 60_000,
  });

  const { data: spellData } = useQuery({
    queryKey: ['compendium', 'spells', 'lookup'],
    queryFn: () => searchSpells({ limit: 5000 }),
    staleTime: 5 * 60_000,
  });

  const lookup = useMemo(
    () => buildSpellLookup(spellData?.items ?? []),
    [spellData?.items],
  );

  const abilities = useMemo(
    () => (monster ? getMonsterAbilities(monster.description, monster.stats) : []),
    [monster],
  );

  const saves = useMemo(
    () => (monster?.description ? parseSavingThrows(monster.description) : []),
    [monster?.description],
  );

  const actions = useMemo(() => {
    if (!monster?.description) return [];
    const prof = proficiencyBonusFromCr(monster.cr);
    return parseMonsterActions(monster.description, lookup).map((action) => {
      const toHit = inferMonsterAttackToHit(action, abilities, prof);
      return toHit !== undefined && action.toHit === undefined ? { ...action, toHit } : action;
    });
  }, [monster?.description, monster?.cr, lookup, abilities]);

  const spellcasting = useMemo(
    () => actions.filter((action) => action.isSpellcastingBlock),
    [actions],
  );
  const tabActions = useMemo(
    () => actions.filter((action) => !action.isSpellcastingBlock && !action.spellParent),
    [actions],
  );

  const dexMod = abilities.find((a) => a.name === 'DEX')?.mod;
  const npcActions = useMemo(
    () => (token.attackText ? parseNpcAttacks(token.attackText) : []),
    [token.attackText],
  );
  const activePickName = targetPick?.attackerTokenId === token.id ? targetPick.actionName : null;

  function ActionSection({ title, items }: { title: string; items: ParsedAction[] }) {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <h4 className="font-display text-[10px] tracking-wide uppercase px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          {title}
        </h4>
        {items.map((action, i) => (
          <TokenActionCard
            key={`${action.name}-${i}`}
            action={action}
            token={token}
            isActivePick={activePickName === action.name}
          />
        ))}
      </div>
    );
  }

  return (
    <DraggablePanel
      title={token.name}
      subtitle={`AC ${token.ac ?? 10} · ${token.hp}/${token.maxHp} HP`}
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, window.innerWidth - 340), y: 80 }}
      width={320}
      maxHeight="calc(100vh - 100px)"
      zIndex={160}
    >
      <PanelTargetPicker token={token} />
      <PanelAttackResult token={token} />

      <div className="p-2 space-y-2">
        {!token.monsterId && npcActions.length > 0 && (
          <>
            <div className="pb-1" style={{ borderBottom: `1px solid ${BD}` }}>
              <RollModeBar className="w-full" />
            </div>
            <ActionSection title="Actions" items={npcActions} />
            {token.attackText && (
              <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                {token.attackText}
              </p>
            )}
          </>
        )}
        {!token.monsterId && npcActions.length === 0 && token.attackText && (
          <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
            {token.attackText}
          </p>
        )}
        {!token.monsterId && !token.attackText && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
            Token has no linked monster
          </p>
        )}
        {token.monsterId && isLoading && (
          <p className="font-ui text-xs text-center py-4 skeleton h-8" />
        )}
        {token.monsterId && isError && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-accent-red-hot)' }}>
            Could not load monster
          </p>
        )}

        {token.monsterId && !isLoading && !isError && (
          <>
            <div className="pb-1" style={{ borderBottom: `1px solid ${BD}` }}>
              <RollModeBar className="w-full" />
            </div>

            {(abilities.length > 0 || saves.length > 0 || dexMod !== undefined) && (
              <div className="flex flex-wrap gap-1 pb-1" style={{ borderBottom: `1px solid ${BD}` }}>
                {dexMod !== undefined && (
                  <RollButton
                    notation={`1d20${dexMod >= 0 ? '+' : ''}${dexMod}`}
                    label={`Init ${dexMod >= 0 ? '+' : ''}${dexMod}`}
                    variant="attack"
                  />
                )}
                {saves.map((save) => (
                  <RollButton
                    key={save.name}
                    notation={`1d20${save.mod >= 0 ? '+' : ''}${save.mod}`}
                    label={`${save.name} ${save.mod >= 0 ? '+' : ''}${save.mod}`}
                  />
                ))}
              </div>
            )}

            {tabActions.length === 0 && spellcasting.length === 0 && (
              <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
                No parsed attacks on this stat block
              </p>
            )}

            <ActionTabList
              actions={tabActions}
              renderUse={(action) => (
                <TokenActionCard
                  action={action}
                  token={token}
                  isActivePick={activePickName === action.name}
                  detailsOnly
                />
              )}
            />
            {spellcasting.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="font-display text-[10px] tracking-wide uppercase px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Spellcasting
                </h4>
                {spellcasting.map((block, i) => (
                  <SpellcastingCard
                    key={`${block.name}-${i}`}
                    block={block}
                    token={token}
                    lookup={lookup}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </DraggablePanel>
  );
}
