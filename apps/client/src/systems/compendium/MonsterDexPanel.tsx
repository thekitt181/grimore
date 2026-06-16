import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useGrimoireAuth } from '@/hooks/useGrimoireAuth';
import { DraggablePanel } from '@/components/DraggablePanel';
import { extractApiError } from '@/lib/apiError';
import { useCompendiumUiStore } from './compendiumStore';
import { getItem, getMonster, getSpell } from './compendiumApi';
import { ItemStatBlock, MonsterStatBlock, SpellStatBlock } from './CompendiumStatBlock';
import { CompendiumCreateForm } from './CompendiumCreateForm';
import { summonMonster } from './summonMonster';
import { placeItemHandout } from './placeItemHandout';
import { useSessionStore } from '@/store/sessionStore';
import { useCompendiumEditor } from './useCompendiumEditor';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';
import { SpellEffectReferencePanel } from './SpellEffectReferencePanel';

export function MonsterDexPanel({ onClose }: { onClose: () => void }) {
  const { isSignedIn } = useGrimoireAuth();
  const isAdmin = useCompendiumEditor();
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const compendiumReady = Boolean(isSignedIn);
  const tab = useCompendiumUiStore((s) => s.tab);
  const summonAt = useCompendiumUiStore((s) => s.summonAt);
  const setSummonAt = useCompendiumUiStore((s) => s.setSummonAt);
  const selectedMonsterId = useCompendiumUiStore((s) => s.selectedMonsterId);
  const selectedItemId = useCompendiumUiStore((s) => s.selectedItemId);
  const selectedSpellId = useCompendiumUiStore((s) => s.selectedSpellId);
  const browseMode = useCompendiumUiStore((s) => s.browseMode);
  const selectedEffectSpellId = useCompendiumUiStore((s) => s.selectedEffectSpellId);
  const creating = useCompendiumUiStore((s) => s.creating);

  const inEffectsView = tab === 'spells' && browseMode === 'effects';

  const queryOpts = { staleTime: 120_000, retry: 1 } as const;

  const monsterQ = useQuery({
    queryKey: ['compendium', 'monster', selectedMonsterId],
    queryFn: () => getMonster(selectedMonsterId!),
    enabled: compendiumReady && tab === 'monsters' && !!selectedMonsterId,
    ...queryOpts,
  });

  const itemQ = useQuery({
    queryKey: ['compendium', 'item', selectedItemId],
    queryFn: () => getItem(selectedItemId!),
    enabled: compendiumReady && tab === 'items' && !!selectedItemId,
    ...queryOpts,
  });

  const spellQ = useQuery({
    queryKey: ['compendium', 'spell', selectedSpellId],
    queryFn: () => getSpell(selectedSpellId!),
    enabled: compendiumReady && tab === 'spells' && !!selectedSpellId,
    ...queryOpts,
  });

  useEffect(() => {
    const url = itemQ.data?.imageUrl ?? monsterQ.data?.imageUrl ?? spellQ.data?.imageUrl;
    preloadCompendiumImageUrl(url);
  }, [itemQ.data?.imageUrl, monsterQ.data?.imageUrl, spellQ.data?.imageUrl]);

  if (!isSignedIn) return null;

  const title = tab === 'monsters' ? 'Monster Dex' : tab === 'items' ? 'Item Reference' : inEffectsView ? 'Spell Effects' : 'Spell Reference';
  const canEdit = isAdmin;
  const activeId =
    tab === 'monsters' ? selectedMonsterId : tab === 'items' ? selectedItemId : inEffectsView ? selectedEffectSpellId : selectedSpellId;
  const activeQ = tab === 'monsters' ? monsterQ : tab === 'items' ? itemQ : spellQ;
  const showLoading = Boolean(!inEffectsView && activeId && activeQ.isPending && !activeQ.isError);
  const showError = Boolean(!inEffectsView && activeId && activeQ.isError);
  const showPickHint = !creating && !activeId;

  return (
    <DraggablePanel
      title={title}
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, window.innerWidth - 380), y: Math.max(16, window.innerHeight - 560) }}
      width={360}
      maxHeight="520px"
      zIndex={130}
    >
      <div className="p-3">
        {creating && <CompendiumCreateForm tab={tab} />}
        {!creating && tab === 'monsters' && monsterQ.data && (
          <MonsterStatBlock
            monster={monsterQ.data}
            editable={canEdit}
            {...(isGM ? {
              onSummon: () => {
                summonMonster(monsterQ.data!, summonAt ?? undefined);
                setSummonAt(null);
              },
            } : {})}
          />
        )}
        {!creating && tab === 'items' && itemQ.data && (
          <ItemStatBlock
            item={itemQ.data}
            editable={canEdit}
            {...(isGM ? { onPlaceHandout: () => { void placeItemHandout(itemQ.data!); } } : {})}
          />
        )}
        {!creating && inEffectsView && selectedEffectSpellId && (
          <SpellEffectReferencePanel
            catalogId={selectedEffectSpellId}
            compendiumLoading={Boolean(selectedSpellId && spellQ.isFetching)}
            compendiumError={Boolean(selectedSpellId && spellQ.isError)}
            {...(spellQ.data ? { spell: spellQ.data } : {})}
          />
        )}
        {!creating && !inEffectsView && tab === 'spells' && spellQ.data && (
          <SpellStatBlock spell={spellQ.data} editable={canEdit} />
        )}
        {showPickHint && (
          <p className="font-ui text-xs text-center py-8 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Select {inEffectsView ? 'a spell effect' : 'an entry'} from the <strong style={{ color: 'var(--color-text-primary)' }}>Compendium</strong> list in the right sidebar.
          </p>
        )}
        {inEffectsView && selectedEffectSpellId && spellQ.isError && selectedSpellId && (
          <p className="font-ui text-[10px] text-center" style={{ color: 'var(--color-accent-red-hot)' }}>
            Could not load compendium spell — map VFX still works.
          </p>
        )}
        {showLoading && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
            Loading…
          </p>
        )}
        {showError && (
          <div className="space-y-2 text-center py-6">
            <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-accent-red-hot)' }}>
              {extractApiError(activeQ.error, 'Could not load this compendium entry')}
            </p>
            <button
              type="button"
              className="btn-ghost text-xs py-1 px-3"
              onClick={() => void activeQ.refetch()}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </DraggablePanel>
  );
}
