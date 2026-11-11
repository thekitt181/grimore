import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TokenItem } from '@/systems/scene/types';
import { DraggablePanel } from '@/components/DraggablePanel';
import { fetchDdbCharacter } from './ddbApi';
import { pullDdbHpToToken } from './useDdbHpSync';
import { parsePcActions } from './ddbActionParser';
import { useCombatStore } from '@/systems/combat/combatStore';
import { RollModeBar } from '@/systems/dice/RollModeBar';
import { PanelAttackResult, PanelTargetPicker } from '@/systems/combat/TokenPanelCombatFlow';
import { TokenActionCard } from '@/systems/combat/TokenActionCard';
import { ActionTabList } from '@/systems/combat/ActionTabList';
import { buildSpellLookup } from '@/systems/compendium/statBlockParser';
import { searchSpells } from '@/systems/compendium/compendiumApi';
import { ddbPanelPosition, ddbPanelWidth } from './ddbTokenUtils';

export function PcActionsPanel({ token, onClose }: { token: TokenItem; onClose: () => void }) {
  const targetPick = useCombatStore((s) => s.targetPick);
  const ddbId = token.ddbCharacterId!;

  const { data: character, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ddb', 'character', ddbId],
    queryFn: async () => {
      const ch = await fetchDdbCharacter(ddbId);
      pullDdbHpToToken(token.id, ch);
      return ch;
    },
    enabled: Boolean(ddbId),
    staleTime: 0,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
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

  const parsed = useMemo(
    () => (character ? parsePcActions(character, lookup) : { attacks: [], spells: [], features: [] }),
    [character, lookup],
  );

  const tabActions = useMemo(
    () => [...parsed.attacks, ...parsed.spells, ...parsed.features],
    [parsed],
  );

  const activePickName =
    targetPick?.attackerTokenId === token.id ? targetPick.actionName : null;

  return (
    <DraggablePanel
      title={token.name}
      subtitle="Character actions"
      onClose={onClose}
      defaultPosition={ddbPanelPosition(Math.max(16, window.innerWidth - 360), 56)}
      width={ddbPanelWidth(320)}
      maxHeight="calc(100vh - 72px)"
      zIndex={160}
    >
      <div className="px-2 py-1 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
        <RollModeBar />
      </div>

      <PanelTargetPicker token={token} />
      <PanelAttackResult token={token} />

      <div className="p-2 space-y-3">
        {isLoading && <p className="font-ui text-xs p-2">Loading…</p>}
        {isError && (
          <div className="space-y-2 p-2">
            <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
              {error instanceof Error ? error.message : 'Failed to load character'}
            </p>
            <button type="button" className="btn-ghost text-[10px]" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}

        {tabActions.length > 0 && (
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
        )}
      </div>
    </DraggablePanel>
  );
}
