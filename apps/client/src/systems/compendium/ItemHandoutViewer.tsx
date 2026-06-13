import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useHandoutViewerStore } from './handoutViewerStore';
import { RollableText } from '@/systems/dice/RollableText';
import { fetchDdbCharacters } from '@/systems/ddb/ddbApi';
import { addHandoutReceiptToInventory } from '@/systems/handouts/handoutApi';

export function ItemHandoutViewer() {
  const content = useHandoutViewerStore((s) => s.content);
  const close = useHandoutViewerStore((s) => s.close);
  const [revealed, setRevealed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
  const [pickCharacterId, setPickCharacterId] = useState<number | ''>('');

  const charactersQ = useQuery({
    queryKey: ['ddb-characters-inventory'],
    queryFn: fetchDdbCharacters,
    enabled: Boolean(content?.receiptId && content.handoutType === 'ITEM_CARD'),
  });

  useEffect(() => {
    if (!content) {
      setRevealed(false);
      setInventoryMsg(null);
      setPickCharacterId('');
      return undefined;
    }
    if (content.animate) {
      setRevealed(false);
      const t = window.setTimeout(() => setRevealed(true), 40);
      return () => window.clearTimeout(t);
    }
    setRevealed(true);
    return undefined;
  }, [content]);

  if (!content) return null;

  const meta = [content.itemType, content.rarity, content.source].filter(Boolean).join(' · ');
  const isItemCard = content.handoutType === 'ITEM_CARD' && Boolean(content.receiptId);

  async function addToInventory() {
    if (!content?.receiptId || !pickCharacterId) return;
    setAdding(true);
    setInventoryMsg(null);
    try {
      const result = await addHandoutReceiptToInventory(content.receiptId, Number(pickCharacterId));
      setInventoryMsg(result.message);
    } catch (err) {
      setInventoryMsg(err instanceof Error ? err.message : 'Could not add item');
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      {content.animate && !revealed && (
        <div
          className="fixed inset-0 z-[154] pointer-events-none flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            className="rounded-xl px-6 py-4 shadow-panel font-display text-lg tracking-wide handout-reveal-burst"
            style={{
              background: 'linear-gradient(135deg, #2a2418 0%, #1a1510 100%)',
              border: '2px solid var(--color-accent-gold)',
              color: 'var(--color-accent-gold)',
            }}
          >
            📜 New handout
          </div>
        </div>
      )}

      <DraggablePanel
        title={content.title}
        subtitle={meta || (content.handoutType?.replace('_', ' ').toLowerCase() ?? 'Handout')}
        onClose={close}
        defaultPosition={{ x: Math.max(16, (window.innerWidth - 420) / 2), y: 80 }}
        width={420}
        maxHeight="85vh"
        zIndex={155}
        {...(content.animate && revealed ? { className: 'handout-reveal-panel' } : {})}
      >
        <div className="p-4 space-y-3">
          {content.imageUrl && (
            <img
              src={content.imageUrl}
              alt=""
              className="w-full max-h-56 object-contain rounded"
              style={{ background: 'var(--color-bg-primary)' }}
            />
          )}
          {content.description ? (
            <RollableText text={content.description} className="text-sm" />
          ) : (
            <p className="font-ui text-xs italic" style={{ color: 'var(--color-text-secondary)' }}>No description.</p>
          )}

          {isItemCard && (
            <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
                Add to D&D Beyond inventory
              </p>
              <select
                className="input w-full text-xs"
                value={pickCharacterId}
                onChange={(e) => setPickCharacterId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Choose character…</option>
                {(charactersQ.data ?? []).map((c) => (
                  <option key={c.ddbCharacterId} value={c.ddbCharacterId}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary w-full text-xs"
                disabled={adding || !pickCharacterId}
                onClick={() => void addToInventory()}
              >
                {adding ? 'Adding…' : content.isCustom ? 'Add as custom item' : 'Add to character sheet'}
              </button>
              {inventoryMsg && (
                <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{inventoryMsg}</p>
              )}
            </div>
          )}
        </div>
      </DraggablePanel>

      <style>{`
        @keyframes handoutBurst {
          0% { transform: scale(0.6) rotate(-4deg); opacity: 0; }
          60% { transform: scale(1.05) rotate(1deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes handoutSlideIn {
          0% { transform: translateY(24px) scale(0.92); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .handout-reveal-burst { animation: handoutBurst 0.55s ease-out forwards; }
        .handout-reveal-panel { animation: handoutSlideIn 0.45s ease-out forwards; }
      `}</style>
    </>
  );
}
