import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TokenItem } from '@/systems/scene/types';
import { DraggablePanel } from '@/components/DraggablePanel';
import { RollableText } from '@/systems/dice/RollableText';
import { syncDdbCharacter } from './ddbApi';
import { pullDdbHpToToken } from './useDdbHpSync';
import { parsePcActions } from './ddbActionParser';
import { useCombatStore } from '@/systems/combat/combatStore';
import { RollModeBar } from '@/systems/dice/RollModeBar';
import { PanelAttackResult, PanelTargetPicker } from '@/systems/combat/TokenPanelCombatFlow';
import { TokenActionCard } from '@/systems/combat/TokenActionCard';
import { hasMeaningfulActionDetail, stripHtmlText } from '@/systems/compendium/actionDetail';
import { buildSpellLookup } from '@/systems/compendium/statBlockParser';
import { searchSpells } from '@/systems/compendium/compendiumApi';
import { ddbPanelPosition, ddbPanelWidth } from './ddbTokenUtils';

const GOLD = 'var(--color-accent-gold)';

export function PcActionsPanel({ token, onClose }: { token: TokenItem; onClose: () => void }) {
  const targetPick = useCombatStore((s) => s.targetPick);
  const ddbId = token.ddbCharacterId!;
  const [detailFeature, setDetailFeature] = useState<{ name: string; text: string } | null>(null);

  const { data: character, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ddb', 'character', ddbId],
    queryFn: async () => {
      const ch = await syncDdbCharacter(ddbId);
      pullDdbHpToToken(token.id, ch);
      return ch;
    },
    enabled: Boolean(ddbId),
    staleTime: 30_000,
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

  const activePickName =
    targetPick?.attackerTokenId === token.id ? targetPick.actionName : null;

  function openFeatureDetail(name: string, rawText: string) {
    const text = stripHtmlText(rawText);
    setDetailFeature({
      name,
      text: hasMeaningfulActionDetail(name, text)
        ? text
        : 'Full rules text is not available from D&D Beyond for this entry. Check your character sheet on DDB for details.',
    });
  }

  return (
    <>
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

          {parsed.attacks.length > 0 && (
            <ActionSection title="Attacks">
              {parsed.attacks.map((action) => (
                <TokenActionCard
                  key={action.name}
                  action={action}
                  token={token}
                  isActivePick={activePickName === action.name}
                  compact
                />
              ))}
            </ActionSection>
          )}

          {parsed.spells.length > 0 && (
            <ActionSection title="Spells">
              {parsed.spells.map((action) => (
                <TokenActionCard
                  key={action.name}
                  action={action}
                  token={token}
                  isActivePick={activePickName === action.name}
                  compact
                />
              ))}
            </ActionSection>
          )}

          {parsed.features.length > 0 && (
            <ActionSection title="Features">
              {parsed.features.map((action) => (
                <TokenActionCard
                  key={action.name}
                  action={action}
                  token={token}
                  isActivePick={false}
                  compact
                  onShowDetails={() => openFeatureDetail(action.name, action.originalText)}
                />
              ))}
            </ActionSection>
          )}
        </div>
      </DraggablePanel>

      {detailFeature && (
        <DraggablePanel
          title={detailFeature.name}
          subtitle="Feature"
          onClose={() => setDetailFeature(null)}
          defaultPosition={{ x: Math.max(16, window.innerWidth - 680), y: 100 }}
          width={340}
          zIndex={170}
        >
          <div className="p-3">
            <RollableText
              text={detailFeature.text}
              className="font-ui text-xs max-h-64 overflow-y-auto opacity-90"
            />
          </div>
        </DraggablePanel>
      )}
    </>
  );
}

function ActionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-display text-[10px] tracking-wider mb-1 px-1" style={{ color: GOLD }}>{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
