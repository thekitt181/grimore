import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useHandoutViewerStore } from './handoutViewerStore';
import { RollableText } from '@/systems/dice/RollableText';
import { fetchGrimoireDdbLink, fetchDdbCharacters } from '@/systems/ddb/ddbApi';
import axios from 'axios';
import { addHandoutReceiptToInventory, type HandoutInventoryManualFallback } from '@/systems/handouts/handoutApi';
import { useSessionStore } from '@/store/sessionStore';
import type { HandoutInventoryTarget } from '@grimoire/shared';
import { extractApiError } from '@/lib/apiError';

export function ItemHandoutViewer() {
  const content = useHandoutViewerStore((s) => s.content);
  const close = useHandoutViewerStore((s) => s.close);
  const campaignId = useSessionStore((s) => s.campaignId);
  const [revealed, setRevealed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
  const [inventoryOk, setInventoryOk] = useState<boolean | null>(null);
  const [manualFallback, setManualFallback] = useState<HandoutInventoryManualFallback | null>(null);
  const [copiedName, setCopiedName] = useState(false);
  const [pickCharacterId, setPickCharacterId] = useState<number | ''>('');
  const [inventoryTarget, setInventoryTarget] = useState<HandoutInventoryTarget>('character');

  const charactersQ = useQuery({
    queryKey: ['ddb-characters-inventory'],
    queryFn: fetchDdbCharacters,
    enabled: Boolean(content?.receiptId && content.handoutType === 'ITEM_CARD'),
  });

  const ddbLinkQ = useQuery({
    queryKey: ['ddb-campaign-link', campaignId],
    queryFn: () => fetchGrimoireDdbLink(campaignId!),
    enabled: Boolean(campaignId && content?.receiptId && content.handoutType === 'ITEM_CARD'),
  });

  const partyInventoryAvailable = Boolean(ddbLinkQ.data?.ddbCampaignId);

  const selectableCharacters = (charactersQ.data ?? []).filter((c) =>
    inventoryTarget === 'character'
      ? c.isOwned === true || c.isCampaignCharacter === true
      : true,
  );

  useEffect(() => {
    if (!content) {
      setRevealed(false);
      setInventoryMsg(null);
      setInventoryOk(null);
      setManualFallback(null);
      setCopiedName(false);
      setPickCharacterId('');
      setInventoryTarget('character');
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

  useEffect(() => {
    if (selectableCharacters.length === 1) {
      setPickCharacterId(selectableCharacters[0]!.ddbCharacterId);
      return;
    }
    if (
      pickCharacterId
      && !selectableCharacters.some((c) => c.ddbCharacterId === pickCharacterId)
    ) {
      setPickCharacterId('');
    }
  }, [inventoryTarget, selectableCharacters, pickCharacterId]);

  if (!content) return null;

  const meta = [content.itemType, content.rarity, content.source].filter(Boolean).join(' · ');
  const isItemCard = content.handoutType === 'ITEM_CARD' && Boolean(content.receiptId);
  const isCustomItem = Boolean(content.isCustom);

  async function addToInventory() {
    if (!content?.receiptId) return;
    if (inventoryTarget === 'character' && !pickCharacterId) return;
    if (inventoryTarget === 'party' && !pickCharacterId && selectableCharacters.length > 0) return;

    setAdding(true);
    setInventoryMsg(null);
    setInventoryOk(null);
    setManualFallback(null);
    try {
      const result = await addHandoutReceiptToInventory(
        content.receiptId,
        Number(pickCharacterId),
        inventoryTarget,
        content.description,
      );
      if (result.ok) {
        setInventoryMsg(result.message);
        setInventoryOk(true);
        setManualFallback(null);
        setCopiedName(false);
        return;
      }
      setInventoryMsg(result.message);
      setInventoryOk(false);
      setManualFallback(result.manualFallback ?? {
        characterUrl: `https://www.dndbeyond.com/characters/${pickCharacterId}`,
        itemName: content.title,
        isCustom: isCustomItem,
        target: inventoryTarget,
      });
    } catch (err) {
      setInventoryMsg(extractApiError(err, 'Could not add item'));
      setInventoryOk(false);
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { manualFallback?: HandoutInventoryManualFallback } | undefined;
        setManualFallback(data?.manualFallback ?? {
          characterUrl: `https://www.dndbeyond.com/characters/${pickCharacterId}`,
          itemName: content.title,
          isCustom: isCustomItem,
          target: inventoryTarget,
        });
      }
    } finally {
      setAdding(false);
    }
  }

  const itemDisplayName = content.title.trim() || 'Item';

  async function copyItemName() {
    const name = manualFallback?.itemName ?? itemDisplayName;
    try {
      await navigator.clipboard.writeText(name);
      setCopiedName(true);
      window.setTimeout(() => setCopiedName(false), 2000);
    } catch {
      setInventoryMsg('Could not copy to clipboard — select and copy the item name manually.');
      setInventoryOk(false);
    }
  }

  const addButtonLabel = adding
    ? 'Adding…'
    : inventoryTarget === 'party'
      ? (isCustomItem ? 'Add as custom to party inventory' : 'Add to party inventory')
      : (isCustomItem ? 'Add as custom item' : 'Add to character sheet');

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
                Add to D&D Beyond
              </p>
              <select
                className="input w-full text-xs"
                value={inventoryTarget}
                onChange={(e) => setInventoryTarget(e.target.value as HandoutInventoryTarget)}
              >
                <option value="character">My character inventory</option>
                <option value="party" disabled={!partyInventoryAvailable}>
                  Campaign party inventory{partyInventoryAvailable ? '' : ' (link DDB campaign first)'}
                </option>
              </select>
              <select
                className="input w-full text-xs"
                value={pickCharacterId}
                onChange={(e) => setPickCharacterId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">
                  {inventoryTarget === 'party' ? 'Choose campaign character (API context)…' : 'Choose character…'}
                </option>
                {selectableCharacters.map((c) => (
                  <option key={c.ddbCharacterId} value={c.ddbCharacterId}>
                    {c.name}{c.classLabel ? ` · ${c.classLabel}` : ''}
                  </option>
                ))}
              </select>
              {inventoryTarget === 'party' && (
                <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  D&amp;D Beyond requires a linked campaign character to authorize the request. The item is added to
                  the shared <strong>Party Inventory</strong> tab (not that character&apos;s personal gear).
                </p>
              )}
              {inventoryTarget === 'character' && selectableCharacters.length === 0 && (
                <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  No editable characters found. Link your D&D Beyond account in Settings — your own
                  characters and PCs in your linked campaign (if you can edit them on dndbeyond.com) appear here.
                </p>
              )}
              <button
                type="button"
                className="btn-primary w-full text-xs"
                disabled={
                  adding
                  || !pickCharacterId
                  || selectableCharacters.length === 0
                  || (inventoryTarget === 'party' && !partyInventoryAvailable)
                }
                onClick={() => void addToInventory()}
              >
                {addButtonLabel}
              </button>
              {manualFallback && inventoryOk === false && (
                <div className="space-y-2 rounded border p-2" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {manualFallback.target === 'party'
                      ? 'Could not add this item to party inventory automatically. Add it manually in D&D Beyond:'
                      : 'Could not add this item automatically. Add it on the character sheet in D&D Beyond:'}
                  </p>
                  <ol className="font-ui text-[10px] list-decimal list-inside space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
                    <li>Open a campaign character on D&amp;D Beyond (button below).</li>
                    <li>
                      {manualFallback.target === 'party'
                        ? <>Open <strong>Inventory → Party Inventory</strong>.</>
                        : <>Click <strong>Manage Equipment</strong>.</>}
                    </li>
                    <li>
                      {manualFallback.isCustom
                        ? <>Choose <strong>Add Custom Item</strong> and paste the handout details.</>
                        : manualFallback.target === 'party'
                          ? <>Search for <strong>{manualFallback.itemName}</strong> in party inventory and add it.</>
                          : <>Search for <strong>{manualFallback.itemName}</strong> and add it.</>}
                    </li>
                  </ol>
                  <div className="flex gap-2">
                    <a
                      href={manualFallback.characterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary flex-1 text-xs text-center"
                    >
                      {manualFallback.target === 'party' ? 'Open campaign character' : 'Open character sheet'}
                    </a>
                    <button
                      type="button"
                      className="btn-secondary flex-1 text-xs"
                      onClick={() => void copyItemName()}
                    >
                      {copiedName ? 'Copied!' : 'Copy item name'}
                    </button>
                  </div>
                </div>
              )}
              {inventoryMsg && (
                <p
                  className="font-ui text-[10px]"
                  style={{
                    color: inventoryOk === false
                      ? 'var(--color-danger, #c44)'
                      : inventoryOk === true
                        ? 'var(--color-accent-gold)'
                        : 'var(--color-text-secondary)',
                  }}
                >
                  {inventoryMsg}
                </p>
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
