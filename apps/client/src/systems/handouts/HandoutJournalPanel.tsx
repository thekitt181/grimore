import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useHandoutJournalStore } from './handoutJournalStore';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { syncDdbCharacter } from '@/systems/ddb/ddbApi';
import type { HandoutReceiptRecord, GrimoireInventoryItem } from '@grimoire/shared';
import type { TokenItem } from '@/systems/scene/types';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';
const ACTIVE_POLL_MS = 8_000;
const IDLE_POLL_MS = 25_000;

interface HandoutJournalPanelProps {
  campaignId: string;
  onClose: () => void;
}

type JournalGroup = {
  key: string;
  name: string;
  receipts: HandoutReceiptRecord[];
  ddbCharacterIds: number[];
};

function normName(value: string): string {
  return value.trim().toLowerCase();
}

function labelMatch(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(`${y} `) || y.startsWith(`${x} `)) return true;
  if (x.includes(`(${y})`) || y.includes(`(${x})`)) return true;
  return false;
}

function pcTokensForJournal(tokens: TokenItem[], isGM: boolean, myUserId: string | null): TokenItem[] {
  const pcs = tokens.filter((t) => Boolean(t.ddbCharacterId));
  if (isGM) return pcs;
  return pcs.filter((t) => !t.ownerId || (myUserId != null && t.ownerId === myUserId));
}

function sortInventory(items: GrimoireInventoryItem[]): GrimoireInventoryItem[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.equipped) !== Boolean(b.equipped)) return a.equipped ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function HandoutJournalPanel({ campaignId, onClose }: HandoutJournalPanelProps) {
  const isGM = useSessionStore((s) => s.myRole) === 'GM';
  const myUserId = useSessionStore((s) => s.myUserId);
  const connectedUsers = useSessionStore((s) => s.connectedUsers);
  const entries = useHandoutJournalStore((s) => s.entries);
  const loading = useHandoutJournalStore((s) => s.loading);
  const loadJournal = useHandoutJournalStore((s) => s.loadJournal);
  const receiptToViewerContent = useHandoutJournalStore((s) => s.receiptToViewerContent);
  const openContent = useHandoutViewerStore((s) => s.openContent);
  const qc = useQueryClient();
  const [tabKey, setTabKey] = useState<string | null>(null);

  const pcTokens = useItemStore(
    useShallow((s) =>
      pcTokensForJournal(
        Object.values(s.items).filter((i): i is TokenItem => i.type === 'token'),
        isGM,
        myUserId,
      ),
    ),
  );

  useEffect(() => {
    void loadJournal(campaignId);
  }, [campaignId, loadJournal]);

  const grouped = useMemo(() => {
    const groups = new Map<string, JournalGroup>();
    const userById = new Map(connectedUsers.map((u) => [u.id, u]));

    const ensure = (key: string, name: string): JournalGroup => {
      const existing = groups.get(key);
      if (existing) {
        if (name && existing.name === 'Player') existing.name = name;
        return existing;
      }
      const created: JournalGroup = { key, name, receipts: [], ddbCharacterIds: [] };
      groups.set(key, created);
      return created;
    };

    if (isGM) {
      for (const entry of entries) {
        const user = userById.get(entry.userId);
        ensure(entry.userId, entry.recipientName?.trim() || user?.username || 'Player')
          .receipts.push(entry);
      }
      for (const user of connectedUsers) {
        if (user.role === 'PLAYER') ensure(user.id, user.username);
      }
    } else {
      ensure(myUserId ?? 'me', 'You').receipts.push(...entries);
    }

    const findKeyForToken = (token: TokenItem): string => {
      if (token.ownerId && groups.has(token.ownerId)) return token.ownerId;
      const owner = token.ownerId ? userById.get(token.ownerId) : undefined;
      if (owner?.role === 'PLAYER') return ensure(owner.id, owner.username).key;
      for (const group of groups.values()) {
        if (labelMatch(group.name, token.name)) return group.key;
      }
      return `ddb:${token.ddbCharacterId}`;
    };

    for (const token of pcTokens) {
      const id = token.ddbCharacterId!;
      const group = ensure(findKeyForToken(token), token.name);
      if (!group.ddbCharacterIds.includes(id)) group.ddbCharacterIds.push(id);
      if (labelMatch(group.name, 'Player') || (!isGM && group.name === 'You')) {
        group.name = token.name;
      }
    }

    return [...groups.values()].filter((g) => g.receipts.length > 0 || g.ddbCharacterIds.length > 0);
  }, [isGM, entries, myUserId, connectedUsers, pcTokens]);

  const ddbIds = useMemo(
    () => [...new Set(grouped.flatMap((g) => g.ddbCharacterIds))],
    [grouped],
  );

  const active = grouped.find((g) => g.key === tabKey) ?? grouped[0] ?? null;
  const activeDdbIds = new Set(active?.ddbCharacterIds ?? []);

  const ddbQueries = useQueries({
    queries: ddbIds.map((id) => ({
      queryKey: ['ddb', 'character', id],
      queryFn: () => syncDdbCharacter(id),
      staleTime: 0,
      refetchInterval: activeDdbIds.has(id) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    })),
  });

  const characterById = useMemo(() => {
    const map = new Map<number, (typeof ddbQueries)[number]['data']>();
    ddbIds.forEach((id, i) => {
      const data = ddbQueries[i]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [ddbIds, ddbQueries]);

  useEffect(() => {
    if (!tabKey && grouped[0]) setTabKey(grouped[0].key);
    else if (tabKey && grouped.length > 0 && !grouped.some((g) => g.key === tabKey)) {
      setTabKey(grouped[0]?.key ?? null);
    }
  }, [grouped, tabKey]);

  const inventory = useMemo(() => {
    if (!active) return [];
    const seen = new Set<string>();
    const items: GrimoireInventoryItem[] = [];
    for (const id of active.ddbCharacterIds) {
      const character = characterById.get(id);
      for (const item of character?.inventory ?? []) {
        const key = `${item.id}:${normName(item.name)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
    return sortInventory(items);
  }, [active, characterById]);

  const ddbNames = useMemo(() => new Set(inventory.map((i) => normName(i.name))), [inventory]);
  const tableOnly = (active?.receipts ?? []).filter((e) => !ddbNames.has(normName(e.title)));
  const activeLoading = active?.ddbCharacterIds.some((id) => {
    const i = ddbIds.indexOf(id);
    return i >= 0 && ddbQueries[i]?.isLoading && !ddbQueries[i]?.data;
  }) ?? false;
  const activeFetching = active?.ddbCharacterIds.some((id) => {
    const i = ddbIds.indexOf(id);
    return i >= 0 && Boolean(ddbQueries[i]?.isFetching);
  }) ?? false;
  const activeError = active?.ddbCharacterIds
    .map((id) => {
      const i = ddbIds.indexOf(id);
      const err = ddbQueries[i]?.error;
      return err instanceof Error ? err.message : null;
    })
    .find(Boolean) ?? null;

  const empty = !loading && grouped.length === 0;

  async function refreshActive() {
    if (!active) return;
    await Promise.allSettled(
      active.ddbCharacterIds.map(async (id) => {
        const ch = await syncDdbCharacter(id);
        qc.setQueryData(['ddb', 'character', id], ch);
      }),
    );
  }

  return (
    <DraggablePanel
      title="Journal"
      subtitle={isGM ? 'Player inventories, live from D&D Beyond' : 'Your handouts and D&D Beyond inventory'}
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, window.innerWidth - 400), y: 96 }}
      width={380}
      maxHeight="75vh"
      zIndex={154}
    >
      <div className="p-3">
        {empty && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {isGM
              ? 'No players with a sheet or handouts yet. Import a D&D Beyond character or Give to players.'
              : 'No inventory yet. Put your D&D Beyond character on the map, or wait for a handout.'}
          </p>
        )}

        {grouped.length > 1 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {grouped.map((group) => {
              const on = group.key === active?.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  className="font-ui text-[10px] px-2 py-1 rounded max-w-[140px] truncate"
                  style={{
                    color: on ? GOLD : 'var(--color-text-secondary)',
                    border: `1px solid ${on ? GOLD : BD}`,
                    background: on ? 'rgba(201,168,76,0.12)' : 'transparent',
                  }}
                  onClick={() => setTabKey(group.key)}
                >
                  {group.name}
                </button>
              );
            })}
          </div>
        )}

        {active && (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                {activeLoading
                  ? 'Loading inventory…'
                  : activeFetching
                    ? 'Live sync…'
                    : inventory.length > 0
                      ? `${inventory.length} on D&D Beyond`
                      : active.ddbCharacterIds.length > 0
                        ? 'Sheet is empty'
                        : 'No D&D Beyond character on the map'}
              </p>
              {active.ddbCharacterIds.length > 0 && (
                <button
                  type="button"
                  className="btn-primary text-[10px] px-2 py-1 shrink-0"
                  disabled={activeFetching}
                  onClick={() => void refreshActive()}
                >
                  Refresh
                </button>
              )}
            </div>
            {activeError && (
              <p className="font-ui text-[10px] mb-2" style={{ color: 'var(--color-accent-red, #f87171)' }}>
                {activeError}
              </p>
            )}

            <div className="max-h-[48vh] overflow-y-auto space-y-3">
              <ul className="space-y-1">
                {inventory.map((item) => {
                  const usesLeft = item.usesMax && item.usesMax > 0
                    ? `${item.usesRemaining ?? item.usesMax}/${item.usesMax} left`
                    : null;
                  const meta = [
                    item.type,
                    item.rarity,
                    item.equipped ? 'equipped' : null,
                    usesLeft,
                  ].filter(Boolean).join(' · ');
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full text-left rounded-lg px-2 py-1.5"
                        style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
                        onClick={() => openContent({
                          title: item.name,
                          description: item.description?.trim()
                            || (item.equipped ? 'Equipped on D&D Beyond.' : 'On the D&D Beyond character sheet.'),
                          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
                          ...(item.type ? { itemType: item.type } : {}),
                          ...(item.rarity ? { rarity: item.rarity } : {}),
                          source: 'D&D Beyond',
                          handoutType: 'ITEM_CARD',
                          ...(item.quantity > 1 ? { quantity: item.quantity } : {}),
                          ...(item.usesMax && item.usesMax > 0
                            ? {
                                usesMax: item.usesMax,
                                usesRemaining: item.usesRemaining ?? item.usesMax,
                                ...(item.usesReset ? { usesReset: item.usesReset } : {}),
                              }
                            : {}),
                        })}
                      >
                        <p className="font-display text-sm" style={{ color: 'var(--color-text-primary)' }}>
                          {item.equipped ? '⚔ ' : ''}
                          {item.name}
                          {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                        </p>
                        {meta && (
                          <p className="font-ui text-[10px]" style={{ color: usesLeft ? GOLD : 'var(--color-text-secondary)' }}>
                            {meta}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!activeLoading && active.ddbCharacterIds.length > 0 && inventory.length === 0 && !activeError && (
                <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  Nothing in this inventory. Removed items drop off on the next live sync.
                </p>
              )}

              {tableOnly.length > 0 && (
                <div>
                  <p className="font-ui text-[9px] uppercase tracking-wider mb-1 px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    Given at table — not on sheet
                  </p>
                  <ul className="space-y-1">
                    {tableOnly.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="w-full text-left rounded-lg p-2"
                          style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
                          onClick={() => openContent({ ...receiptToViewerContent(entry), animate: true })}
                        >
                          <p className="font-display text-sm" style={{ color: 'var(--color-text-primary)' }}>
                            {entry.title}
                          </p>
                          <p className="font-ui text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            {new Date(entry.receivedAt).toLocaleString()}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DraggablePanel>
  );
}
