import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useCompendiumUiStore } from './compendiumStore';
import { getItem, getMonster, getSpell } from './compendiumApi';
import { ItemStatBlock, MonsterStatBlock, SpellStatBlock } from './CompendiumStatBlock';
import { CompendiumCreateForm } from './CompendiumCreateForm';
import { summonMonster } from './summonMonster';
import { placeItemHandout } from './placeItemHandout';
import { useSessionStore } from '@/store/sessionStore';
import { useCompendiumEditor } from './useCompendiumEditor';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';

export function MonsterDexPanel({ onClose }: { onClose: () => void }) {
  const { isSignedIn } = useAuth();
  const isAdmin = useCompendiumEditor();
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const compendiumReady = Boolean(isSignedIn);
  const tab = useCompendiumUiStore((s) => s.tab);
  const summonAt = useCompendiumUiStore((s) => s.summonAt);
  const setSummonAt = useCompendiumUiStore((s) => s.setSummonAt);
  const selectedMonsterId = useCompendiumUiStore((s) => s.selectedMonsterId);
  const selectedItemId = useCompendiumUiStore((s) => s.selectedItemId);
  const selectedSpellId = useCompendiumUiStore((s) => s.selectedSpellId);
  const creating = useCompendiumUiStore((s) => s.creating);

  const monsterQ = useQuery({
    queryKey: ['compendium', 'monster', selectedMonsterId],
    queryFn: () => getMonster(selectedMonsterId!),
    enabled: compendiumReady && tab === 'monsters' && !!selectedMonsterId,
    staleTime: 120_000,
  });

  const itemQ = useQuery({
    queryKey: ['compendium', 'item', selectedItemId],
    queryFn: () => getItem(selectedItemId!),
    enabled: compendiumReady && tab === 'items' && !!selectedItemId,
    staleTime: 120_000,
  });

  const spellQ = useQuery({
    queryKey: ['compendium', 'spell', selectedSpellId],
    queryFn: () => getSpell(selectedSpellId!),
    enabled: compendiumReady && tab === 'spells' && !!selectedSpellId,
    staleTime: 120_000,
  });

  useEffect(() => {
    const url = itemQ.data?.imageUrl ?? monsterQ.data?.imageUrl ?? spellQ.data?.imageUrl;
    preloadCompendiumImageUrl(url);
  }, [itemQ.data?.imageUrl, monsterQ.data?.imageUrl, spellQ.data?.imageUrl]);

  if (!isSignedIn) return null;

  const title = tab === 'monsters' ? 'Monster Dex' : tab === 'items' ? 'Item Reference' : 'Spell Reference';
  const canEdit = isAdmin;

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
        {!creating && tab === 'spells' && spellQ.data && <SpellStatBlock spell={spellQ.data} editable={canEdit} />}
        {!creating && !selectedMonsterId && !selectedItemId && !selectedSpellId && (
          <p className="font-ui text-xs text-center py-8 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Select an entry from the <strong style={{ color: 'var(--color-text-primary)' }}>Compendium</strong> list in the right sidebar.
          </p>
        )}
        {(monsterQ.isLoading || itemQ.isLoading || spellQ.isLoading) && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        )}
      </div>
    </DraggablePanel>
  );
}
