import { useShallow } from 'zustand/react/shallow';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { PartyCharacterCard } from '../components/PartyCharacterCard';

export function PartyDdbTab() {
  const pcTokens = useItemStore(
    useShallow((s) =>
      Object.values(s.items).filter(
        (i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId),
      ),
    ),
  );

  if (pcTokens.length === 0) {
    return (
      <p className="font-ui text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        No D&amp;D Beyond PCs on the map yet. Import a character from the sidebar → <strong>Import PC</strong>, then link the token.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
        Sync pulls spell slots, inventory, and death saves from D&amp;D Beyond. HP/death saves push when <strong>Push HP</strong> is enabled on the token.
      </p>
      {pcTokens.map((token) => (
        <PartyCharacterCard key={token.id} token={token} />
      ))}
    </div>
  );
}
