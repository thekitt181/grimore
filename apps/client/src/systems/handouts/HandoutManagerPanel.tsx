import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HandoutRecord, HandoutType } from '@grimoire/shared';
import { DraggablePanel } from '@/components/DraggablePanel';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { useSessionStore } from '@/store/sessionStore';
import {
  createCampaignHandout,
  deleteCampaignHandout,
  fetchCampaignHandouts,
  revealCampaignHandout,
  updateCampaignHandout,
} from './handoutApi';

const HANDOUT_TYPES: Array<{ id: HandoutType; label: string }> = [
  { id: 'TEXT', label: 'Text note' },
  { id: 'IMAGE', label: 'Image' },
  { id: 'MAP_FRAGMENT', label: 'Map fragment' },
  { id: 'ITEM_CARD', label: 'Item card' },
];

interface HandoutManagerPanelProps {
  campaignId: string;
  sessionId: string;
  onClose: () => void;
}

export function HandoutManagerPanel({ campaignId, sessionId, onClose }: HandoutManagerPanelProps) {
  const connectedUsers = useSessionStore((s) => s.connectedUsers);
  const players = connectedUsers.filter((u) => u.role === 'PLAYER');

  const handoutsQ = useQuery({
    queryKey: ['handouts', campaignId],
    queryFn: () => fetchCampaignHandouts(campaignId),
  });

  const [editing, setEditing] = useState<HandoutRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [type, setType] = useState<HandoutType>('TEXT');
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState('');
  const [itemRarity, setItemRarity] = useState('');
  const [itemSource, setItemSource] = useState('');
  const [itemIsCustom, setItemIsCustom] = useState(false);
  const [targetMode, setTargetMode] = useState<'all' | 'pick'>('all');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setContent(editing.content ?? '');
    setImageUrl(editing.imageUrl ?? '');
    setType(editing.type);
    setItemName(editing.itemMeta?.name ?? editing.title);
    setItemType(editing.itemMeta?.itemType ?? '');
    setItemRarity(editing.itemMeta?.rarity ?? '');
    setItemSource(editing.itemMeta?.source ?? '');
    setItemIsCustom(Boolean(editing.itemMeta?.isCustom));
  }, [editing]);

  function resetForm() {
    setEditing(null);
    setCreating(false);
    setTitle('');
    setContent('');
    setImageUrl('');
    setType('TEXT');
    setItemName('');
    setItemType('');
    setItemRarity('');
    setItemSource('');
    setItemIsCustom(false);
  }

  function startCreate() {
    resetForm();
    setCreating(true);
  }

  async function saveHandout() {
    if (!title.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const itemMeta = type === 'ITEM_CARD'
        ? {
            name: itemName.trim() || title.trim(),
            ...(itemType.trim() ? { itemType: itemType.trim() } : {}),
            ...(itemRarity.trim() ? { rarity: itemRarity.trim() } : {}),
            ...(itemSource.trim() ? { source: itemSource.trim() } : {}),
            isCustom: itemIsCustom,
          }
        : null;
      const payload = {
        title: title.trim(),
        content: content.trim() || null,
        imageUrl: imageUrl.trim() || null,
        type,
        itemMeta,
      };
      if (editing) {
        await updateCampaignHandout(editing.id, payload);
        setMessage('Handout updated');
      } else {
        await createCampaignHandout(campaignId, payload);
        setMessage('Handout created');
      }
      resetForm();
      await handoutsQ.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeHandout(id: string) {
    if (!window.confirm('Delete this handout?')) return;
    setBusy(true);
    try {
      await deleteCampaignHandout(id);
      await handoutsQ.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function revealHandout(handout: HandoutRecord) {
    setBusy(true);
    setMessage(null);
    try {
      const targets = targetMode === 'all' ? 'all' as const : targetIds;
      if (targetMode === 'pick' && targetIds.length === 0) {
        setMessage('Select at least one player');
        return;
      }
      await revealCampaignHandout(handout.id, sessionId, targets);
      setMessage(`Revealed "${handout.title}"`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Reveal failed');
    } finally {
      setBusy(false);
    }
  }

  async function onImageFile(file: File | undefined) {
    if (!file) return;
    try {
      setImageUrl(await fileToDataUrl(file));
    } catch {
      setMessage('Could not read image file');
    }
  }

  const showEditor = creating || editing;

  return (
    <DraggablePanel
      title="Handouts"
      subtitle="Create lore, maps, and item cards for players"
      onClose={onClose}
      defaultPosition={{ x: 24, y: 72 }}
      width={420}
      maxHeight="85vh"
      zIndex={165}
    >
      <div className="p-3 space-y-3">
        {message && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-accent-gold)' }}>{message}</p>
        )}

        {!showEditor && (
          <>
            <button type="button" className="btn-primary w-full text-xs" onClick={startCreate}>
              + New handout
            </button>

            <div className="space-y-1">
              <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                Reveal to
              </p>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn-ghost text-xs py-0.5 px-2"
                  style={{ color: targetMode === 'all' ? 'var(--color-accent-gold)' : undefined }}
                  onClick={() => setTargetMode('all')}
                >
                  All players
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs py-0.5 px-2"
                  style={{ color: targetMode === 'pick' ? 'var(--color-accent-gold)' : undefined }}
                  onClick={() => setTargetMode('pick')}
                >
                  Selected
                </button>
              </div>
              {targetMode === 'pick' && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {players.map((p) => {
                    const on = targetIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className="text-[10px] px-2 py-0.5 rounded font-ui"
                        style={{
                          background: on ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-tertiary)',
                          color: on ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                        }}
                        onClick={() => setTargetIds((prev) => (
                          on ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                        ))}
                      >
                        {p.username}
                      </button>
                    );
                  })}
                  {players.length === 0 && (
                    <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                      No players connected
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="gold-divider" />

            {(handoutsQ.data ?? []).length === 0 && !handoutsQ.isLoading && (
              <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                No handouts yet — create scrolls, letters, map fragments, or item cards.
              </p>
            )}

            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {(handoutsQ.data ?? []).map((h) => (
                <li
                  key={h.id}
                  className="rounded-lg p-2"
                  style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {h.title}
                      </p>
                      <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                        {h.type.replace('_', ' ').toLowerCase()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="btn-primary text-[10px] py-0.5 px-2" disabled={busy} onClick={() => void revealHandout(h)}>
                        Reveal
                      </button>
                      <button type="button" className="btn-ghost text-[10px] py-0.5 px-1" onClick={() => { setCreating(false); setEditing(h); }}>
                        Edit
                      </button>
                      <button type="button" className="btn-ghost text-[10px] py-0.5 px-1" onClick={() => void removeHandout(h.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {showEditor && (
          <div className="space-y-2">
            <label className="font-ui text-xs block">
              Title
              <input className="input mt-1 w-full text-xs" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="font-ui text-xs block">
              Type
              <select className="input mt-1 w-full text-xs" value={type} onChange={(e) => setType(e.target.value as HandoutType)}>
                {HANDOUT_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="font-ui text-xs block">
              Text / description
              <textarea className="input mt-1 w-full text-xs min-h-[80px]" value={content} onChange={(e) => setContent(e.target.value)} />
            </label>
            <label className="font-ui text-xs block">
              Image URL
              <input className="input mt-1 w-full text-xs" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… or upload below" />
            </label>
            <input type="file" accept="image/*" className="w-full text-[10px]" onChange={(e) => void onImageFile(e.target.files?.[0])} />

            {type === 'ITEM_CARD' && (
              <div className="space-y-2 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
                <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
                  Item details
                </p>
                <input className="input w-full text-xs" placeholder="Item name" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                <input className="input w-full text-xs" placeholder="Type (e.g. Wondrous Item)" value={itemType} onChange={(e) => setItemType(e.target.value)} />
                <input className="input w-full text-xs" placeholder="Rarity" value={itemRarity} onChange={(e) => setItemRarity(e.target.value)} />
                <input className="input w-full text-xs" placeholder="Source book" value={itemSource} onChange={(e) => setItemSource(e.target.value)} />
                <label className="flex items-center gap-2 font-ui text-xs">
                  <input type="checkbox" checked={itemIsCustom} onChange={(e) => setItemIsCustom(e.target.checked)} />
                  Custom / homebrew item (push as custom on D&D Beyond)
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" className="btn-primary flex-1 text-xs" disabled={busy || !title.trim()} onClick={() => void saveHandout()}>
                {editing ? 'Save changes' : 'Create handout'}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={resetForm}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </DraggablePanel>
  );
}
